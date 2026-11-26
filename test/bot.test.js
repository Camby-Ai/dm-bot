import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Bot, matchesKeyword, UserError } from '../src/bot.js';
import { route, verifySignature } from '../src/routes.js';

function makeBot(env = {}) {
  const db = new DatabaseSync(':memory:');
  const calls = [];
  let clock = 1_000_000_000_000;
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const u = String(url);
    if (u.includes('fields=is_user_follow_business')) {
      return new Response(JSON.stringify({ is_user_follow_business: env.FOLLOWS ?? true }), { status: 200 });
    }
    if (u.includes('fields=username')) return new Response(JSON.stringify({ username: 'dmguy' }), { status: 200 });
    return new Response(JSON.stringify({ message_id: 'x' }), { status: 200 });
  };
  const bot = new Bot({
    sql: (q, ...p) => db.prepare(q).all(...p),
    env: { DRY_RUN: 'false', IG_ACCESS_TOKEN: 'tok', PUBLIC_URL: 'https://bot.test', IG_USER_ID: 'OWN', IG_USERNAME: 'tester_account', ...env },
    fetchFn,
    now: () => clock,
  });
  bot.migrate();
  return { bot, calls, tick: (ms) => (clock += ms) };
}

const AUTO = {
  name: 'Build list', keywords: 'BUILD', match_comment: 1, match_dm: 1, media_id: 'M1', media_label: 'five things',
  comment_replies: 'Sent, check your DMs.', opener_text: 'Quick question: what do you sell?', opener_buttons: 'Home services\nOther',
  delivery_text: 'Here it is.', link_url: 'https://example.com/guide', link_label: 'Open the guide', fallback_minutes: 60,
};
const comment = (id, from, text, media = 'M1') => ({
  entry: [{ id: 'OWN', changes: [{ field: 'comments', value: { id, text, from: { id: from, username: 'u_' + from }, media: { id: media } } }] }],
});
const dm = (mid, from, text, quick) => ({
  entry: [{ id: 'OWN', messaging: [{ sender: { id: from }, recipient: { id: 'OWN' }, timestamp: 1, message: { mid, text, ...(quick ? { quick_reply: { payload: quick } } : {}) } }] }],
});
const sent = (calls) => calls.filter((c) => c.method === 'POST');

test('keyword matching is whole word, any case, phrases ok', () => {
  assert.ok(matchesKeyword('BUILD!!', ['build']));
  assert.ok(matchesKeyword('I want the 5 THINGS list', ['5 things']));
  assert.ok(!matchesKeyword('rebuild', ['build']));
  assert.ok(!matchesKeyword('building', ['build']));
});

test('signature check', async () => {
  const body = '{"a":1}';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('sec'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.ok(await verifySignature('sec', body, 'sha256=' + sig));
  assert.ok(!(await verifySignature('sec', body, 'sha256=' + '0'.repeat(64))));
  assert.ok(!(await verifySignature('', body, 'sha256=' + sig)));
  assert.ok(!(await verifySignature('sec', body, null)));
});

test('comment: public reply, private-reply opener, then answer delivers tracked link', async () => {
  const { bot, calls } = makeBot();
  bot.setStatus(bot.saveAutomation(AUTO).id, 'live');
  await bot.handleWebhook(comment('c1', 'U1', 'build please'));
  let posts = sent(calls);
  assert.equal(posts.length, 2);
  assert.match(posts[0].url, /\/c1\/replies\?message=/);
  assert.deepEqual(posts[1].body.recipient, { comment_id: 'c1' });
  assert.equal(posts[1].body.message.quick_replies.length, 2);
  const run = bot.all('SELECT * FROM runs')[0];
  assert.equal(run.state, 'opened');
  assert.ok(run.fallback_due_at);

  await bot.handleWebhook(dm('m1', 'U1', 'I run an HVAC company'));
  posts = sent(calls);
  const last = posts.at(-1);
  assert.deepEqual(last.body.recipient, { id: 'U1' });
  const btn = last.body.message.attachment.payload.buttons[0];
  assert.match(btn.url, /^https:\/\/bot\.test\/l\//);
  assert.equal(bot.all('SELECT * FROM runs')[0].state, 'delivered');
  assert.equal(bot.all('SELECT * FROM runs')[0].answer, 'I run an HVAC company');

  const token = btn.url.split('/l/')[1];
  assert.equal(bot.click(token), 'https://example.com/guide');
  assert.ok(bot.all('SELECT * FROM runs')[0].clicked_at);
});

test('tap answer delivers; duplicate events and repeat comments do not double send', async () => {
  const { bot, calls } = makeBot();
  bot.setStatus(bot.saveAutomation(AUTO).id, 'live');
  await bot.handleWebhook(comment('c1', 'U1', 'BUILD'));
  await bot.handleWebhook(comment('c1', 'U1', 'BUILD')); // same webhook delivered twice
  await bot.handleWebhook(comment('c2', 'U1', 'BUILD again')); // same person again
  assert.equal(bot.all('SELECT * FROM runs').length, 1);
  const runId = bot.all('SELECT id FROM runs')[0].id;
  const before = sent(calls).length;
  await bot.handleWebhook(dm('m2', 'U1', 'Home services', `ANS:${runId}:0`));
  await bot.handleWebhook(dm('m2', 'U1', 'Home services', `ANS:${runId}:0`)); // duplicate
  assert.equal(sent(calls).length - before, 1);
});

test('own comments and other reels and echo are ignored', async () => {
  const { bot, calls } = makeBot();
  bot.setStatus(bot.saveAutomation(AUTO).id, 'live');
  await bot.handleWebhook(comment('c1', 'OWN', 'BUILD'));
  await bot.handleWebhook(comment('c2', 'U2', 'BUILD', 'OTHER_REEL'));
  await bot.handleWebhook(comment('c3', 'U3', 'nothing relevant'));
  assert.equal(sent(calls).length, 0);
});

test('DM keyword starts a run; fallback sends the guide after an hour', async () => {
  const { bot, calls, tick } = makeBot();
  bot.setStatus(bot.saveAutomation(AUTO).id, 'live');
  await bot.handleWebhook(dm('m1', 'U9', 'Build'));
  assert.equal(bot.all('SELECT * FROM runs')[0].source, 'dm');
  assert.equal(bot.all('SELECT * FROM runs')[0].state, 'opened');
  const n = sent(calls).length;
  tick(30 * 60000);
  await bot.tick();
  assert.equal(sent(calls).length, n); // not due yet
  tick(31 * 60000);
  await bot.tick();
  assert.equal(sent(calls).length, n + 1);
  assert.equal(bot.all('SELECT * FROM runs')[0].state, 'fallback');
  // a late answer after fallback does nothing
  await bot.handleWebhook(dm('m2', 'U9', 'hvac'));
  assert.equal(sent(calls).length, n + 1);
});

test('follow gate holds the link until they follow, then delivers', async () => {
  const env = { FOLLOWS: false };
  const { bot, calls } = makeBot(env);
  bot.setStatus(bot.saveAutomation({ ...AUTO, require_follow: 1 }).id, 'live');
  await bot.handleWebhook(dm('m1', 'U5', 'build'));
  await bot.handleWebhook(dm('m2', 'U5', 'plumbing'));
  let last = sent(calls).at(-1);
  assert.equal(last.body.message.attachment.payload.buttons[1].type, 'postback');
  assert.equal(bot.all('SELECT * FROM runs')[0].state, 'awaiting_follow');
  env.FOLLOWS = true;
  // fetch closure reads env.FOLLOWS at call time via the captured object
  const runId = bot.all('SELECT id FROM runs')[0].id;
  await bot.handleWebhook({ entry: [{ id: 'OWN', messaging: [{ sender: { id: 'U5' }, timestamp: 2, postback: { mid: 'p1', payload: 'FOLLOWED:' + runId } }] }] });
  assert.equal(bot.all('SELECT * FROM runs')[0].state, 'delivered');
  last = sent(calls).at(-1);
  assert.equal(last.body.message.attachment.payload.buttons[0].type, 'web_url');
});

test('blank opener sends the guide straight away (private reply for a comment)', async () => {
  const { bot, calls } = makeBot();
  bot.setStatus(bot.saveAutomation({ ...AUTO, opener_text: '', opener_buttons: '' }).id, 'live');
  await bot.handleWebhook(comment('c1', 'U1', 'build'));
  const last = sent(calls).at(-1);
  assert.deepEqual(last.body.recipient, { comment_id: 'c1' });
  assert.equal(bot.all('SELECT * FROM runs')[0].state, 'delivered');
});

test('a refused tap-answer opener is retried as plain text', async () => {
  const { bot, calls } = makeBot();
  let first = true;
  bot.fetchFn = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: String(url), method: opts.method || 'GET', body });
    if (body?.message?.quick_replies && first) {
      first = false;
      return new Response(JSON.stringify({ error: { message: 'quick replies not allowed' } }), { status: 400 });
    }
    return new Response('{}', { status: 200 });
  };
  bot.setStatus(bot.saveAutomation(AUTO).id, 'live');
  await bot.handleWebhook(comment('c1', 'U1', 'build'));
  assert.equal(bot.all('SELECT * FROM runs')[0].state, 'opened');
  assert.equal(sent(calls).at(-1).body.message.quick_replies, undefined);
});

test('dry run sends nothing and logs it; simulate drives the flow', async () => {
  const { bot, calls } = makeBot({ DRY_RUN: 'true' });
  bot.setStatus(bot.saveAutomation({ ...AUTO, media_id: '*' }).id, 'live');
  await bot.simulate({ type: 'comment', username: 'tester', text: 'BUILD', media_id: '*' });
  await bot.simulate({ type: 'dm', username: 'tester', text: 'hvac' });
  assert.equal(calls.length, 0);
  assert.ok(bot.log().every((l) => l.status === 'dry'));
  assert.equal(bot.all('SELECT * FROM runs')[0].state, 'delivered');
});

test('validation: cannot go live without a reel for comments or without content', () => {
  const { bot } = makeBot();
  const a = bot.saveAutomation({ ...AUTO, media_id: '' });
  assert.throws(() => bot.setStatus(a.id, 'live'), UserError);
  assert.throws(() => bot.saveAutomation({ ...AUTO, keywords: '' }), UserError);
  assert.throws(() => bot.saveAutomation({ ...AUTO, link_url: 'javascript:alert(1)' }), UserError);
  assert.throws(() => bot.saveAutomation({ ...AUTO, opener_buttons: 'x'.repeat(21) }), UserError);
});

test('delete contact removes their runs and log', async () => {
  const { bot } = makeBot();
  bot.setStatus(bot.saveAutomation(AUTO).id, 'live');
  await bot.handleWebhook(comment('c1', 'U1', 'build'));
  bot.deleteContact('U1');
  assert.equal(bot.all('SELECT * FROM runs').length, 0);
  assert.equal(bot.all('SELECT * FROM contacts').length, 0);
});

test('routes: webhook verify, bad signature, admin needs login, pages load', async () => {
  const { bot } = makeBot({ VERIFY_TOKEN: 'v', IG_APP_SECRET: 'sec', ADMIN_PASSWORD: 'pw' });
  const env = { VERIFY_TOKEN: 'v', IG_APP_SECRET: 'sec', ADMIN_PASSWORD: 'pw' };
  let r = await route(bot, new Request('https://bot.test/webhook?hub.mode=subscribe&hub.verify_token=v&hub.challenge=123'), env);
  assert.equal(await r.text(), '123');
  r = await route(bot, new Request('https://bot.test/webhook?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=123'), env);
  assert.equal(r.status, 403);
  r = await route(bot, new Request('https://bot.test/webhook', { method: 'POST', body: '{}' }), env);
  assert.equal(r.status, 401);
  r = await route(bot, new Request('https://bot.test/admin/api/state'), env);
  assert.equal(r.status, 401);
  for (const p of ['/privacy', '/data-deletion', '/admin']) {
    r = await route(bot, new Request('https://bot.test' + p), env);
    assert.equal(r.status, 200, p);
  }
  const form = new FormData();
  form.set('password', 'pw');
  r = await route(bot, new Request('https://bot.test/admin/login', { method: 'POST', body: form }), env);
  assert.equal(r.status, 303);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  r = await route(bot, new Request('https://bot.test/admin/api/state', { headers: { cookie } }), env);
  assert.equal(r.status, 200);
  r = await route(bot, new Request('https://bot.test/admin/api/automation', { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: '{}' }), env);
  assert.equal(r.status, 415);
});

test('two accounts: events route by account, each sends from its own account id', async () => {
  const { bot, calls } = makeBot();
  bot.addAccount({ id: '2222222', handle: 'mikeysfomo' });
  bot.setStatus(bot.saveAutomation(AUTO).id, 'live'); // belongs to the first account (OWN)
  const pl = bot.saveAutomation({ ...AUTO, name: 'Pluppy', keywords: 'MIX', media_id: 'P1', account_id: '2222222' });
  bot.setStatus(pl.id, 'live');
  // keyword for account 1 sent to account 2: no reply
  await bot.handleWebhook({ entry: [{ id: '2222222', messaging: [{ sender: { id: 'U1' }, timestamp: 1, message: { mid: 'a', text: 'build' } }] }] });
  assert.equal(sent(calls).length, 0);
  // right keyword to account 2: sends from account 2
  await bot.handleWebhook({ entry: [{ id: '2222222', messaging: [{ sender: { id: 'U1' }, timestamp: 2, message: { mid: 'b', text: 'mix' } }] }] });
  assert.match(sent(calls).at(-1).url, /\/2222222\/messages/);
  // account 1 still works from its own id
  await bot.handleWebhook(dm('c', 'U2', 'build'));
  assert.match(sent(calls).at(-1).url, /\/OWN\/messages/);
  assert.equal(bot.contacts().find((c) => c.igsid === 'U1').account_handle, 'mikeysfomo');
});

test('own accounts never trigger each other and unknown accounts are logged', async () => {
  const { bot, calls } = makeBot();
  bot.addAccount({ id: '2222222', handle: 'mikeysfomo' });
  bot.setStatus(bot.saveAutomation(AUTO).id, 'live');
  await bot.handleWebhook({ entry: [{ id: 'OWN', messaging: [{ sender: { id: '2222222' }, timestamp: 1, message: { mid: 'x', text: 'build' } }] }] });
  await bot.handleWebhook({ entry: [{ id: '999', changes: [] }] });
  assert.equal(sent(calls).length, 0);
  assert.ok(bot.log().some((l) => /does not know/.test(l.detail)));
});

test('removing an account with automations is refused', () => {
  const { bot } = makeBot();
  bot.saveAutomation(AUTO);
  assert.throws(() => bot.removeAccount('OWN'), UserError);
  assert.throws(() => bot.addAccount({ id: 'abc', handle: 'x' }), UserError);
});

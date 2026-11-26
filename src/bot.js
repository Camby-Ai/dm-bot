// Core logic. Storage-agnostic: it takes a function sql(query, ...params) -> rows[],
// so it runs on Durable Object SQLite in production and on node:sqlite in tests.

const HOUR = 3600000;
const DAY = 24 * HOUR;

export class UserError extends Error {}

export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Whole word or phrase, any case, extra words fine. "5 things" matches "I want the 5 THINGS!!"
export function matchesKeyword(text, keywords) {
  const t = ' ' + normalize(text) + ' ';
  return keywords.some((k) => {
    const n = normalize(k);
    return n && t.includes(' ' + n + ' ');
  });
}

function rand(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function slug(s) {
  return normalize(s).replace(/ /g, '-').slice(0, 40) || 'automation';
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const parseArr = (s) => {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'off',
    media_id TEXT, media_label TEXT, keywords TEXT NOT NULL DEFAULT '[]',
    match_comment INTEGER NOT NULL DEFAULT 1, match_dm INTEGER NOT NULL DEFAULT 1,
    comment_replies TEXT NOT NULL DEFAULT '[]',
    opener_text TEXT NOT NULL DEFAULT '', opener_buttons TEXT NOT NULL DEFAULT '[]',
    delivery_text TEXT NOT NULL DEFAULT '', link_url TEXT, link_label TEXT,
    require_follow INTEGER NOT NULL DEFAULT 0, follow_text TEXT NOT NULL DEFAULT '',
    fallback_text TEXT NOT NULL DEFAULT '', fallback_minutes INTEGER NOT NULL DEFAULT 60,
    created_at INTEGER, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS contacts (
    igsid TEXT PRIMARY KEY, username TEXT, first_seen INTEGER, last_seen INTEGER)`,
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, igsid TEXT NOT NULL, username TEXT,
    source TEXT, comment_id TEXT, comment_text TEXT, state TEXT NOT NULL, token TEXT,
    answer TEXT, created_at INTEGER, opened_at INTEGER, answered_at INTEGER,
    delivered_at INTEGER, clicked_at INTEGER, fallback_due_at INTEGER, last_user_at INTEGER,
    UNIQUE (automation_id, igsid))`,
  `CREATE INDEX IF NOT EXISTS runs_token ON runs (token)`,
  `CREATE INDEX IF NOT EXISTS runs_igsid ON runs (igsid)`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, handle TEXT NOT NULL, label TEXT, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS events (key TEXT PRIMARY KEY, at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, kind TEXT, to_id TEXT, run_id TEXT,
    payload TEXT, status TEXT, detail TEXT)`,
];

export class Bot {
  constructor({ sql, env, fetchFn, now }) {
    this.sql = sql;
    this.env = env || {};
    this.fetchFn = fetchFn || ((...a) => fetch(...a));
    this.now = now || (() => Date.now());
  }

  // ---------- storage helpers ----------
  all(q, ...p) {
    return this.sql(q, ...p.map((v) => (v === undefined ? null : v)));
  }
  get(q, ...p) {
    return this.all(q, ...p)[0] || null;
  }
  run(q, ...p) {
    this.all(q, ...p);
  }
  migrate() {
    for (const s of SCHEMA) this.run(s);
    // Multi-account: older databases get the column added, and existing rows join the first account.
    for (const s of ['ALTER TABLE automations ADD COLUMN account_id TEXT', 'ALTER TABLE runs ADD COLUMN account_id TEXT']) {
      try {
        this.run(s);
      } catch {
        /* column already there */
      }
    }
    if (!this.get('SELECT 1 AS x FROM accounts LIMIT 1') && this.env.IG_USER_ID) {
      this.run('INSERT INTO accounts (id, handle, label, created_at) VALUES (?,?,?,?)',
        String(this.env.IG_USER_ID), this.env.IG_USERNAME || 'your_handle', null, this.now());
    }
    const first = this.get('SELECT id FROM accounts ORDER BY created_at LIMIT 1');
    if (first) {
      this.run('UPDATE automations SET account_id = ? WHERE account_id IS NULL', first.id);
      this.run('UPDATE runs SET account_id = ? WHERE account_id IS NULL', first.id);
    }
  }

  // ---------- accounts (one admin, several Instagram handles) ----------
  accounts() {
    return this.all('SELECT * FROM accounts ORDER BY created_at');
  }
  account(id) {
    return this.get('SELECT * FROM accounts WHERE id = ?', String(id));
  }
  addAccount({ id, handle, label }) {
    id = String(id || '').trim();
    handle = String(handle || '').trim().replace(/^@/, '');
    if (!/^\d{5,}$/.test(id)) throw new UserError('The Instagram account ID is the long number from Meta (digits only).');
    if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) throw new UserError('Enter the handle without the @.');
    this.run(
      `INSERT INTO accounts (id, handle, label, created_at) VALUES (?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET handle = excluded.handle, label = excluded.label`,
      id, handle, String(label || '').trim() || null, this.now()
    );
    return this.account(id);
  }
  removeAccount(id) {
    if (this.get('SELECT 1 AS x FROM automations WHERE account_id = ?', String(id))) {
      throw new UserError('Delete or move this account\'s automations first.');
    }
    this.run('DELETE FROM accounts WHERE id = ?', String(id));
  }
  // The webhook says which account an event is for. If there is exactly one account, any id means it.
  accountForEntry(entryId) {
    return this.account(entryId) || (this.accounts().length === 1 ? this.accounts()[0] : null);
  }
  getSetting(k) {
    return this.get('SELECT v FROM settings WHERE k = ?', k)?.v ?? null;
  }
  setSetting(k, v) {
    this.run('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(v));
  }

  // ---------- config ----------
  token() {
    return this.getSetting('access_token') || this.env.IG_ACCESS_TOKEN || '';
  }
  dryRun() {
    return String(this.env.DRY_RUN).toLowerCase() === 'true' || !this.token();
  }
  base() {
    // graph.instagram.com for Instagram-login tokens, graph.facebook.com for unified-login system-user tokens.
    return `https://${this.env.GRAPH_HOST || 'graph.instagram.com'}/${this.env.GRAPH_VERSION || 'v23.0'}`;
  }
  handle(accountId) {
    return this.account(accountId)?.handle || this.env.IG_USERNAME || 'your_handle';
  }
  publicBase() {
    return (this.env.PUBLIC_URL || this.getSetting('public_url') || '').replace(/\/$/, '');
  }
  notePublicUrl(origin) {
    if (!this.env.PUBLIC_URL && origin && this.getSetting('public_url') !== origin) this.setSetting('public_url', origin);
  }

  // ---------- Instagram API (one door for everything that leaves the bot) ----------
  logOutbox(kind, to, runId, payload, status, detail) {
    this.run(
      'INSERT INTO outbox (at, kind, to_id, run_id, payload, status, detail) VALUES (?,?,?,?,?,?,?)',
      this.now(), kind, to, runId, String(payload).slice(0, 4000), status, String(detail || '').slice(0, 500)
    );
    this.run('DELETE FROM outbox WHERE id <= (SELECT MAX(id) - 500 FROM outbox)');
  }

  async api(kind, { runId = null, to = null, method = 'POST', path, query = null, body = null }) {
    const summary = JSON.stringify({ method, path, query, body });
    if (this.dryRun()) {
      this.logOutbox(kind, to, runId, summary, 'dry', 'Dry run: nothing was sent');
      return { dry: true };
    }
    const url = new URL(this.base() + path);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    const res = await this.fetchFn(url.toString(), {
      method,
      headers: { authorization: `Bearer ${this.token()}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!res.ok || data.error) {
      const msg = data.error?.message || text.slice(0, 200) || `HTTP ${res.status}`;
      this.logOutbox(kind, to, runId, summary, 'error', msg);
      const e = new Error(msg);
      e.status = res.status;
      throw e;
    }
    this.logOutbox(kind, to, runId, summary, 'sent', '');
    return data;
  }

  fill(text, run) {
    return String(text || '').replace(/\{\{\s*username\s*\}\}/gi, run?.username || 'there');
  }

  async sendMessage(run, message, { commentId = null, kind = 'dm' } = {}) {
    return this.api(kind, {
      runId: run.id,
      to: run.igsid,
      path: `/${run.account_id}/messages`,
      body: { recipient: commentId ? { comment_id: commentId } : { id: run.igsid }, message },
    });
  }

  textMsg(text, taps, runId) {
    const m = { text };
    if (taps && taps.length) {
      m.quick_replies = taps.slice(0, 13).map((t, i) => ({
        content_type: 'text',
        title: String(t).slice(0, 20),
        payload: `ANS:${runId}:${i}`,
      }));
    }
    return m;
  }

  buttonMsg(text, buttons) {
    return { attachment: { type: 'template', payload: { template_type: 'button', text: text.slice(0, 640), buttons } } };
  }

  // ---------- automations ----------
  hydrate(a) {
    if (!a) return null;
    return {
      ...a,
      keywords: parseArr(a.keywords),
      comment_replies: parseArr(a.comment_replies),
      opener_buttons: parseArr(a.opener_buttons),
    };
  }
  getAutomation(id) {
    return this.hydrate(this.get('SELECT * FROM automations WHERE id = ?', id));
  }
  liveAutomations(accountId) {
    return this.all(`SELECT * FROM automations WHERE status = 'live' AND account_id = ? ORDER BY created_at`, accountId).map((a) =>
      this.hydrate(a)
    );
  }

  saveAutomation(i) {
    const now = this.now();
    const lines = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((s) => String(s).trim()).filter(Boolean);
    const name = String(i.name || '').trim();
    if (!name) throw new UserError('Give the automation a name.');
    const keywords = [...new Set((Array.isArray(i.keywords) ? i.keywords : String(i.keywords || '').split(',')).map((s) => String(s).trim()).filter(Boolean))];
    if (!keywords.length) throw new UserError('Add at least one keyword.');
    const taps = lines(i.opener_buttons);
    if (taps.length > 13) throw new UserError('Instagram allows at most 13 tap answers.');
    if (taps.some((t) => t.length > 20)) throw new UserError('Each tap answer must be 20 characters or fewer.');
    const linkUrl = String(i.link_url || '').trim();
    if (linkUrl && !/^https?:\/\//i.test(linkUrl)) throw new UserError('The link must start with http:// or https://');
    const linkLabel = String(i.link_label || '').trim();
    if (linkLabel.length > 20) throw new UserError('The button label must be 20 characters or fewer.');
    const mins = Math.max(0, Math.min(1380, parseInt(i.fallback_minutes ?? 60, 10) || 0));
    for (const k of ['opener_text', 'delivery_text', 'fallback_text', 'follow_text']) {
      if (String(i[k] || '').length > 1000) throw new UserError(`${k} is over 1000 characters.`);
    }
    const id = i.id && this.getAutomation(i.id) ? i.id : `${slug(name)}-${rand(2)}`;
    const existing = this.get('SELECT created_at, status, account_id FROM automations WHERE id = ?', id);
    const accountId = String(i.account_id || existing?.account_id || this.accounts()[0]?.id || '');
    if (!this.account(accountId)) throw new UserError('Pick which Instagram account this automation belongs to.');
    this.run(
      `INSERT INTO automations (id, name, status, media_id, media_label, keywords, match_comment, match_dm, comment_replies,
        opener_text, opener_buttons, delivery_text, link_url, link_label, require_follow, follow_text, fallback_text,
        fallback_minutes, created_at, updated_at, account_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id, name=excluded.name, media_id=excluded.media_id, media_label=excluded.media_label,
        keywords=excluded.keywords, match_comment=excluded.match_comment, match_dm=excluded.match_dm,
        comment_replies=excluded.comment_replies, opener_text=excluded.opener_text, opener_buttons=excluded.opener_buttons,
        delivery_text=excluded.delivery_text, link_url=excluded.link_url, link_label=excluded.link_label,
        require_follow=excluded.require_follow, follow_text=excluded.follow_text, fallback_text=excluded.fallback_text,
        fallback_minutes=excluded.fallback_minutes, updated_at=excluded.updated_at`,
      id, name, existing?.status || 'off', String(i.media_id || '').trim() || null, String(i.media_label || '').trim() || null,
      JSON.stringify(keywords), i.match_comment ? 1 : 0, i.match_dm ? 1 : 0, JSON.stringify(lines(i.comment_replies)),
      String(i.opener_text || '').trim(), JSON.stringify(taps), String(i.delivery_text || '').trim(), linkUrl || null,
      linkLabel || null, i.require_follow ? 1 : 0, String(i.follow_text || '').trim(), String(i.fallback_text || '').trim(),
      mins, existing?.created_at || now, now, accountId
    );
    // Editing a live automation keeps it live, but it must still be valid.
    if (existing?.status === 'live') this.assertCanGoLive(this.getAutomation(id));
    return this.getAutomation(id);
  }

  assertCanGoLive(a) {
    if (!a.match_comment && !a.match_dm) throw new UserError('Turn on at least one trigger (comment or DM).');
    if (a.match_comment && !a.media_id) throw new UserError('A comment trigger needs a reel. Pick one, or choose "Any post".');
    if (!a.delivery_text && !a.link_url) throw new UserError('Add the delivery message or a link before going live.');
  }

  setStatus(id, status) {
    const a = this.getAutomation(id);
    if (!a) throw new UserError('Automation not found.');
    if (!['live', 'off'].includes(status)) throw new UserError('Bad status.');
    if (status === 'live') this.assertCanGoLive(a);
    this.run('UPDATE automations SET status = ?, updated_at = ? WHERE id = ?', status, this.now(), id);
    return this.getAutomation(id);
  }

  deleteAutomation(id) {
    this.run('DELETE FROM runs WHERE automation_id = ?', id);
    this.run('DELETE FROM automations WHERE id = ?', id);
  }

  stats() {
    const rows = this.all(
      `SELECT automation_id,
        COUNT(*) AS started,
        SUM(CASE WHEN source = 'comment' THEN 1 ELSE 0 END) AS from_comments,
        SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
        SUM(CASE WHEN answered_at IS NOT NULL THEN 1 ELSE 0 END) AS answered,
        SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
        SUM(CASE WHEN state IN ('failed','expired') THEN 1 ELSE 0 END) AS failed
       FROM runs GROUP BY automation_id`
    );
    return Object.fromEntries(rows.map((r) => [r.automation_id, r]));
  }

  // ---------- webhook entry ----------
  claimEvent(key) {
    if (this.get('SELECT 1 AS x FROM events WHERE key = ?', key)) return false;
    this.run('INSERT INTO events (key, at) VALUES (?, ?)', key, this.now());
    return true;
  }

  async handleWebhook(payload) {
    for (const entry of payload?.entry || []) {
      const account = this.accountForEntry(entry.id);
      if (!account) {
        this.logOutbox('webhook', null, null, '', 'error', `Event for an Instagram account this bot does not know (${entry.id}). Add it under Setup.`);
        continue;
      }
      const ownId = String(entry.id || account.id);
      for (const ch of entry.changes || []) {
        if (ch.field === 'comments' || ch.field === 'live_comments') {
          await this.safely('comment', () => this.onComment(account, ownId, ch.value || {}));
        }
      }
      for (const m of entry.messaging || []) {
        if (m.message?.is_echo || String(m.sender?.id) === ownId) continue;
        if (m.postback) await this.safely('postback', () => this.onPostback(account, m));
        else if (m.message) await this.safely('message', () => this.onMessage(account, m));
      }
    }
  }

  async safely(kind, fn) {
    try {
      await fn();
    } catch (e) {
      this.logOutbox('error:' + kind, null, null, '', 'error', e.message);
    }
  }

  upsertContact(igsid, username) {
    const now = this.now();
    this.run(
      `INSERT INTO contacts (igsid, username, first_seen, last_seen) VALUES (?,?,?,?)
       ON CONFLICT(igsid) DO UPDATE SET last_seen = excluded.last_seen, username = COALESCE(excluded.username, contacts.username)`,
      igsid, username || null, now, now
    );
  }

  // ---------- triggers ----------
  async onComment(account, ownId, v) {
    const igsid = String(v.from?.id || '');
    if (!igsid || igsid === ownId || this.account(igsid)) return; // never react to our own accounts' comments or replies
    if (!v.id || !this.claimEvent('c:' + v.id)) return;
    const mediaId = String(v.media?.id || '');
    const text = v.text || '';
    const a = this.liveAutomations(account.id).find(
      (x) => x.match_comment && (x.media_id === '*' || x.media_id === mediaId) && matchesKeyword(text, x.keywords)
    );
    if (!a) return;
    await this.startRun(a, { igsid, username: v.from?.username, source: 'comment', commentId: String(v.id), text });
  }

  async onMessage(account, m) {
    const igsid = String(m.sender.id);
    if (this.account(igsid)) return; // one of our own accounts messaging another
    if (!this.claimEvent('m:' + (m.message.mid || `${igsid}:${m.timestamp}`))) return;
    const text = m.message.text || '';
    const now = this.now();
    this.upsertContact(igsid, null);
    this.run('UPDATE runs SET last_user_at = ? WHERE igsid = ? AND account_id = ?', now, igsid, account.id);

    // A tapped answer carries the run id.
    const payload = m.message.quick_reply?.payload;
    if (payload?.startsWith('ANS:')) {
      const run = this.get('SELECT * FROM runs WHERE id = ?', payload.split(':')[1]);
      if (run && run.igsid === igsid && ['opened', 'awaiting_follow'].includes(run.state)) {
        return this.answer(run, text);
      }
    }
    // A new keyword DM starts a run for any live automation this person has not had yet.
    const a = this.liveAutomations(account.id).find(
      (x) =>
        x.match_dm &&
        matchesKeyword(text, x.keywords) &&
        !this.get('SELECT 1 AS x FROM runs WHERE automation_id = ? AND igsid = ?', x.id, igsid)
    );
    if (a) return this.startRun(a, { igsid, username: null, source: 'dm', text });
    // Otherwise it is the answer to an open question.
    const open = this.get(
      `SELECT * FROM runs WHERE igsid = ? AND account_id = ? AND state IN ('opened','awaiting_follow') ORDER BY created_at DESC LIMIT 1`,
      igsid, account.id
    );
    if (open) return this.answer(open, text);
    // Anything else is a normal conversation. The account owner answers it by hand.
  }

  async onPostback(account, m) {
    const igsid = String(m.sender.id);
    const pb = m.postback;
    if (!this.claimEvent('p:' + (pb.mid || `${igsid}:${m.timestamp}:${pb.payload}`))) return;
    this.run('UPDATE runs SET last_user_at = ? WHERE igsid = ? AND account_id = ?', this.now(), igsid, account.id);
    if (!String(pb.payload || '').startsWith('FOLLOWED:')) return;
    const run = this.get('SELECT * FROM runs WHERE id = ?', pb.payload.split(':')[1]);
    if (run && run.igsid === igsid && run.state === 'awaiting_follow') await this.answer(run, null);
  }

  // ---------- the flow ----------
  async startRun(a, { igsid, username, source, commentId = null, text = '' }) {
    if (this.get('SELECT 1 AS x FROM runs WHERE automation_id = ? AND igsid = ?', a.id, igsid)) return; // once per person
    this.upsertContact(igsid, username);
    if (!username) username = await this.lookupUsername(igsid);
    const run = {
      id: rand(8), automation_id: a.id, igsid, username: username || null, source, comment_id: commentId,
      comment_text: String(text).slice(0, 500), state: 'new', token: rand(12), created_at: this.now(), account_id: a.account_id,
    };
    this.run(
      `INSERT INTO runs (id, automation_id, igsid, username, source, comment_id, comment_text, state, token, created_at, last_user_at, account_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      run.id, a.id, igsid, run.username, source, commentId, run.comment_text, 'new', run.token, run.created_at, run.created_at, a.account_id
    );
    if (username) this.upsertContact(igsid, username);
    await this.openRun(a, run);
  }

  async lookupUsername(igsid) {
    if (this.dryRun()) return null;
    try {
      const d = await this.api('profile', { to: igsid, method: 'GET', path: `/${igsid}`, query: { fields: 'username' } });
      return d.username || null;
    } catch {
      return null;
    }
  }

  fail(run, state, detail) {
    this.run('UPDATE runs SET state = ? WHERE id = ?', state, run.id);
    this.logOutbox('run:' + state, run.igsid, run.id, '', 'error', detail);
  }

  async openRun(a, run) {
    const commentId = run.source === 'comment' ? run.comment_id : null;
    try {
      if (commentId && a.comment_replies.length) {
        // A failed public reply must never block the DM.
        await this.safely('comment_reply', () =>
          this.api('comment_reply', {
            runId: run.id, to: run.igsid, path: `/${commentId}/replies`,
            query: { message: this.fill(pick(a.comment_replies), run) },
          })
        );
      }
      if (!a.opener_text) return await this.deliver(a, run, { commentId });
      const opener = this.fill(a.opener_text, run);
      try {
        await this.sendMessage(run, this.textMsg(opener, a.opener_buttons, run.id), { commentId, kind: 'opener' });
      } catch (e) {
        // If Instagram refuses tap answers on this message, send the question as plain text.
        if (!a.opener_buttons.length) throw e;
        await this.sendMessage(run, this.textMsg(opener, [], run.id), { commentId, kind: 'opener' });
      }
      const now = this.now();
      const due = a.fallback_minutes > 0 ? now + a.fallback_minutes * 60000 : null;
      this.run(`UPDATE runs SET state = 'opened', opened_at = ?, fallback_due_at = ? WHERE id = ?`, now, due, run.id);
    } catch (e) {
      this.fail(run, 'failed', e.message);
    }
  }

  async answer(run, text) {
    // Claim the run before any await so a duplicate event cannot deliver twice.
    const claimed = this.get(`SELECT state FROM runs WHERE id = ?`, run.id);
    if (!claimed || !['opened', 'awaiting_follow'].includes(claimed.state)) return;
    const firstAnswer = !run.answered_at && text !== null;
    this.run(
      `UPDATE runs SET state = 'answering', answer = COALESCE(?, answer), answered_at = COALESCE(answered_at, ?) WHERE id = ?`,
      text, this.now(), run.id
    );
    const a = this.getAutomation(run.automation_id);
    if (!a) return this.fail(run, 'failed', 'Automation was deleted');
    run = this.get('SELECT * FROM runs WHERE id = ?', run.id);
    if (firstAnswer) await this.notify(`${run.username ? '@' + run.username : 'Someone'} answered "${a.name}": ${String(text).slice(0, 200)}`);
    try {
      if (a.require_follow && !(await this.isFollowing(run))) {
        await this.sendMessage(
          run,
          this.buttonMsg(this.fill(a.follow_text, run) || 'Follow me first, then tap the button and I will send it.', [
            { type: 'web_url', url: `https://www.instagram.com/${this.handle(run.account_id)}/`, title: `Follow @${this.handle(run.account_id)}`.slice(0, 20) },
            { type: 'postback', title: "I'm following", payload: `FOLLOWED:${run.id}` },
          ]),
          { kind: 'follow_prompt' }
        );
        this.run(`UPDATE runs SET state = 'awaiting_follow' WHERE id = ?`, run.id);
        return;
      }
      await this.deliver(a, run);
    } catch (e) {
      this.fail(run, 'failed', e.message);
    }
  }

  async isFollowing(run) {
    if (this.dryRun()) return !/nofollow/i.test(run.username || '');
    try {
      const d = await this.api('follow_check', { to: run.igsid, method: 'GET', path: `/${run.igsid}`, query: { fields: 'is_user_follow_business' } });
      return d.is_user_follow_business !== false; // if Instagram does not say, never hold the guide back
    } catch {
      return true;
    }
  }

  async deliver(a, run, { fallback = false, commentId = null } = {}) {
    const text = this.fill((fallback && a.fallback_text) || a.delivery_text, run);
    const opts = { commentId, kind: fallback ? 'fallback' : 'delivery' };
    const link = a.link_url ? `${this.publicBase()}/l/${run.token}` : null;
    if (link) {
      const label = a.link_label || 'Open the guide';
      const btn = [{ type: 'web_url', url: link, title: label.slice(0, 20) }];
      if (text.length > 620) {
        await this.sendMessage(run, { text }, opts);
        await this.sendMessage(run, this.buttonMsg('Tap to open it.', btn), { ...opts, commentId: null });
      } else {
        await this.sendMessage(run, this.buttonMsg(text || 'Here it is.', btn), opts);
      }
    } else {
      await this.sendMessage(run, { text }, opts);
    }
    this.run(
      `UPDATE runs SET state = ?, delivered_at = ?, opened_at = COALESCE(opened_at, ?) WHERE id = ?`,
      fallback ? 'fallback' : 'delivered', this.now(), this.now(), run.id
    );
  }

  async notify(msg) {
    const topic = this.env.NTFY_TOPIC;
    if (!topic || this.dryRun()) return;
    try {
      await this.fetchFn(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: 'POST', body: msg, headers: { title: 'DM bot' } });
    } catch {
      /* alerts are best effort */
    }
  }

  // ---------- link tracking ----------
  click(token) {
    const run = this.get('SELECT * FROM runs WHERE token = ?', token);
    if (!run) return null;
    const a = this.getAutomation(run.automation_id);
    if (!a?.link_url) return null;
    if (!run.clicked_at) this.run('UPDATE runs SET clicked_at = ? WHERE id = ?', this.now(), run.id);
    return a.link_url;
  }

  // ---------- cron ----------
  async tick() {
    const now = this.now();
    const due = this.all(
      `SELECT * FROM runs WHERE state IN ('opened','awaiting_follow') AND fallback_due_at IS NOT NULL AND fallback_due_at <= ?`,
      now
    );
    for (const run of due) {
      const claimed = this.get('SELECT state FROM runs WHERE id = ?', run.id);
      if (!['opened', 'awaiting_follow'].includes(claimed?.state)) continue;
      this.run(`UPDATE runs SET state = 'fallback_sending' WHERE id = ?`, run.id);
      const a = this.getAutomation(run.automation_id);
      if (!a) {
        this.fail(run, 'expired', 'Automation was deleted');
        continue;
      }
      try {
        await this.deliver(a, run, { fallback: true });
      } catch (e) {
        // Instagram only allows a message within 24 hours of the person's last message or tap.
        this.fail(run, 'expired', e.message);
      }
    }
    this.run('DELETE FROM events WHERE at < ?', now - 14 * DAY);
    await this.refreshToken();
    return due.length;
  }

  async refreshToken() {
    // System-user tokens never expire and have no refresh endpoint.
    if (this.dryRun() || (this.env.GRAPH_HOST && this.env.GRAPH_HOST !== 'graph.instagram.com')) return;
    const now = this.now();
    const last = parseInt(this.getSetting('token_refreshed_at') || '0', 10);
    if (!last) return this.setSetting('token_refreshed_at', now);
    if (now - last < 7 * DAY) return;
    try {
      const url = new URL('https://graph.instagram.com/refresh_access_token');
      url.searchParams.set('grant_type', 'ig_refresh_token');
      url.searchParams.set('access_token', this.token());
      const res = await this.fetchFn(url.toString());
      const d = await res.json();
      if (!res.ok || !d.access_token) throw new Error(d.error?.message || `HTTP ${res.status}`);
      this.setSetting('access_token', d.access_token);
      this.setSetting('token_refreshed_at', now);
      this.logOutbox('token_refresh', null, null, '', 'sent', `Refreshed, expires_in ${d.expires_in}`);
    } catch (e) {
      this.logOutbox('token_refresh', null, null, '', 'error', e.message);
    }
  }

  // ---------- admin reads ----------
  contacts() {
    return this.all(
      `SELECT r.*, a.name AS automation_name, c.handle AS account_handle FROM runs r
       LEFT JOIN automations a ON a.id = r.automation_id LEFT JOIN accounts c ON c.id = r.account_id
       ORDER BY r.created_at DESC LIMIT 500`
    );
  }
  deleteContact(igsid) {
    this.run('DELETE FROM runs WHERE igsid = ?', igsid);
    this.run('DELETE FROM outbox WHERE to_id = ?', igsid);
    this.run('DELETE FROM contacts WHERE igsid = ?', igsid);
  }
  log() {
    return this.all('SELECT * FROM outbox ORDER BY id DESC LIMIT 200');
  }
  state() {
    const s = this.stats();
    return {
      mode: {
        dryRun: this.dryRun(),
        dryRunFlag: String(this.env.DRY_RUN).toLowerCase() === 'true',
        hasToken: !!this.token(),
        hasAppSecret: !!this.env.IG_APP_SECRET,
        hasVerifyToken: !!this.env.VERIFY_TOKEN,
        handle: this.accounts()[0]?.handle || this.handle(),
      },
      accounts: this.accounts(),
      urls: { base: this.publicBase() },
      automations: this.all('SELECT * FROM automations ORDER BY created_at DESC').map((a) => ({
        ...this.hydrate(a),
        stats: s[a.id] || { started: 0, from_comments: 0, opened: 0, answered: 0, delivered: 0, clicked: 0, failed: 0 },
      })),
    };
  }

  async media(accountId) {
    const acct = this.account(accountId) || this.accounts()[0];
    if (!acct) throw new UserError('Add an Instagram account under Setup first.');
    const d = await this.api('media', {
      method: 'GET', path: `/${acct.id}/media`,
      query: { fields: 'id,caption,permalink,media_product_type,timestamp', limit: '30' },
    });
    return (d.data || []).map((m) => ({
      id: m.id, type: m.media_product_type, permalink: m.permalink, at: m.timestamp,
      label: (m.caption || '(no caption)').replace(/\s+/g, ' ').slice(0, 70),
    }));
  }

  // Ask Instagram which webhook fields this account is subscribed to, and optionally subscribe it.
  async subscriptions(accountId, subscribe = false) {
    const acct = this.account(accountId) || this.accounts()[0];
    if (!acct) throw new UserError('Add an Instagram account under Setup first.');
    if (subscribe) {
      await this.api('subscribe', {
        path: `/${acct.id}/subscribed_apps`,
        query: { subscribed_fields: 'comments,messages,messaging_postbacks' },
      });
    }
    const d = await this.api('subscriptions', {
      method: 'GET', path: `/${acct.id}/subscribed_apps`, query: { fields: 'id,name,subscribed_fields' },
    });
    return { account: acct.handle, subscribed_apps: d.data || d };
  }

  // Dry run only: push a fake event through the same code path the webhook uses.
  async simulate({ type, username, text, media_id, run_id, account_id }) {
    if (!this.dryRun()) throw new UserError('Simulation only works in dry run, so it can never message a real person.');
    const user = String(username || 'tester').replace(/[^a-z0-9._]/gi, '').slice(0, 30) || 'tester';
    const igsid = 'sim_' + user;
    const own = (this.account(account_id) || this.accounts()[0])?.id;
    if (!own) throw new UserError('Add an Instagram account under Setup first.');
    const n = rand(4);
    let payload;
    if (type === 'comment') {
      payload = { entry: [{ id: own, changes: [{ field: 'comments', value: { id: 'simc_' + n, text, from: { id: igsid, username: user }, media: { id: media_id || '*' } } }] }] };
    } else if (type === 'dm') {
      payload = { entry: [{ id: own, messaging: [{ sender: { id: igsid }, recipient: { id: own }, timestamp: this.now(), message: { mid: 'simm_' + n, text } }] }] };
    } else if (type === 'followed') {
      payload = { entry: [{ id: own, messaging: [{ sender: { id: igsid }, recipient: { id: own }, timestamp: this.now(), postback: { mid: 'simp_' + n, payload: 'FOLLOWED:' + run_id } }] }] };
    } else throw new UserError('Unknown simulation type.');
    await this.handleWebhook(payload);
  }
}

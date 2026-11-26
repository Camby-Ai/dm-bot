import { UserError } from './bot.js';
import { adminHtml, loginHtml, privacyHtml, deletionHtml, homeHtml } from './pages.js';

const enc = new TextEncoder();

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const html = (body, status = 200) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'",
    },
  });

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// Meta signs the raw body with the Instagram app secret.
export async function verifySignature(secret, raw, header) {
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  return safeEqual(await hmacHex(secret, raw), header.slice(7));
}

async function makeSession(env) {
  const exp = String(Date.now() + 7 * 86400000);
  return `${exp}.${await hmacHex(env.ADMIN_PASSWORD + '|session', exp)}`;
}
async function hasSession(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const m = /(?:^|;\s*)cb_session=([^;]+)/.exec(request.headers.get('cookie') || '');
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(await hmacHex(env.ADMIN_PASSWORD + '|session', exp), sig);
}

export async function route(bot, request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  bot.notePublicUrl(url.origin);

  // ----- public: Meta webhook -----
  if (path === '/webhook') {
    if (method === 'GET') {
      const ok = url.searchParams.get('hub.mode') === 'subscribe' && env.VERIFY_TOKEN &&
        safeEqual(url.searchParams.get('hub.verify_token') || '', env.VERIFY_TOKEN);
      return ok ? new Response(url.searchParams.get('hub.challenge') || '', { status: 200 }) : new Response('Forbidden', { status: 403 });
    }
    if (method === 'POST') {
      const raw = await request.text();
      if (!(await verifySignature(env.IG_APP_SECRET, raw, request.headers.get('x-hub-signature-256')))) {
        bot.logOutbox('webhook', null, null, '', 'error',
          'Rejected: bad signature. The IG_APP_SECRET is probably the wrong secret (try the other one in Meta).');
        return new Response('Bad signature', { status: 401 });
      }
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return new Response('Bad JSON', { status: 400 });
      }
      await bot.handleWebhook(payload);
      return new Response('ok', { status: 200 });
    }
    return new Response('Method not allowed', { status: 405 });
  }

  // ----- public: tracked link -----
  if (path.startsWith('/l/') && method === 'GET') {
    const dest = bot.click(path.slice(3));
    return dest ? Response.redirect(dest, 302) : new Response('Not found', { status: 404 });
  }

  // ----- public: pages Meta needs -----
  if (path === '/privacy') return html(privacyHtml(env));
  if (path === '/data-deletion') return html(deletionHtml(env));
  if (path === '/') return html(homeHtml(env));

  // ----- admin -----
  if (path === '/admin/login' && method === 'POST') {
    const form = await request.formData();
    if (env.ADMIN_PASSWORD && safeEqual(form.get('password') || '', env.ADMIN_PASSWORD)) {
      return new Response(null, {
        status: 303,
        headers: {
          location: '/admin',
          'set-cookie': `cb_session=${await makeSession(env)}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=604800`,
        },
      });
    }
    await new Promise((r) => setTimeout(r, 800));
    return html(loginHtml('That password did not match.', !!env.ADMIN_PASSWORD), 401);
  }
  if (path === '/admin/logout') {
    return new Response(null, { status: 303, headers: { location: '/admin', 'set-cookie': 'cb_session=; Path=/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict' } });
  }
  if (path === '/admin' || path.startsWith('/admin/api/')) {
    if (!(await hasSession(request, env))) {
      return path === '/admin' ? html(loginHtml('', !!env.ADMIN_PASSWORD)) : json({ error: 'Not signed in' }, 401);
    }
    if (path === '/admin') return html(adminHtml());
    // Non-simple content type forces a CORS preflight, which closes the door on cross-site writes.
    if (method !== 'GET' && !(request.headers.get('content-type') || '').includes('application/json')) {
      return json({ error: 'JSON only' }, 415);
    }
    try {
      return await adminApi(bot, request, path, method);
    } catch (e) {
      if (e instanceof UserError) return json({ error: e.message }, 400);
      return json({ error: e.message || 'Server error' }, 500);
    }
  }
  return new Response('Not found', { status: 404 });
}

async function adminApi(bot, request, path, method) {
  const body = method === 'GET' ? {} : await request.json().catch(() => ({}));
  const seg = path.replace('/admin/api/', '').split('/');
  if (seg[0] === 'state' && method === 'GET') return json(bot.state());
  if (seg[0] === 'media' && method === 'GET') {
    return json({ media: await bot.media(new URL(request.url).searchParams.get('account')) });
  }
  if (seg[0] === 'subscriptions' && method === 'GET') {
    return json(await bot.subscriptions(new URL(request.url).searchParams.get('account'), false));
  }
  if (seg[0] === 'subscribe' && method === 'POST') return json(await bot.subscriptions(body.account_id, true));
  if (seg[0] === 'account' && method === 'POST' && !seg[1]) return json({ account: bot.addAccount(body) });
  if (seg[0] === 'account' && seg[1] && method === 'DELETE') {
    bot.removeAccount(decodeURIComponent(seg[1]));
    return json({ ok: true });
  }
  if (seg[0] === 'contacts' && method === 'GET') return json({ contacts: bot.contacts() });
  if (seg[0] === 'log' && method === 'GET') return json({ log: bot.log() });
  if (seg[0] === 'automation' && method === 'POST' && !seg[1]) return json({ automation: bot.saveAutomation(body) });
  if (seg[0] === 'automation' && seg[2] === 'status' && method === 'POST') return json({ automation: bot.setStatus(seg[1], body.status) });
  if (seg[0] === 'automation' && seg[1] && method === 'DELETE') {
    bot.deleteAutomation(seg[1]);
    return json({ ok: true });
  }
  if (seg[0] === 'contact' && seg[2] === 'delete' && method === 'POST') {
    bot.deleteContact(decodeURIComponent(seg[1]));
    return json({ ok: true });
  }
  if (seg[0] === 'simulate' && method === 'POST') {
    await bot.simulate(body);
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { parsePath, canRead, canWrite } = require('./rules');

const DAY = 24 * 3600 * 1000;
const DOOR_DAYS = 180, SESSION_DAYS = 30;
const DOOR_MAX_FAILS = 10, DOOR_LOCK_MS = 15 * 60 * 1000;
const TOKEN = /^[0-9a-f]{64}$/;

const sha256 = s => crypto.createHash('sha256').update(s).digest();
const sameHash = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function createApp({ store, secret, doorPassword, distFile, trustProxy }) {
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);

  /* the door password is part of the key, so changing it sends everyone back to the door */
  const key = sha256(secret + '\0' + doorPassword);
  /* kind keeps one cookie from passing as the other: a door cookie must not work as a session */
  const mac = (kind, v) => crypto.createHmac('sha256', key).update(kind + ':' + v).digest('hex');
  const sign = (kind, value, days) => { const v = `${value}.${Date.now() + days * DAY}`; return `${v}.${mac(kind, v)}`; };
  const unsign = (kind, cookie) => {
    const parts = String(cookie || '').split('.');
    if (parts.length !== 3) return null;
    const v = parts[0] + '.' + parts[1];
    if (!sameHash(mac(kind, v), parts[2]) || Number(parts[1]) < Date.now()) return null;
    return parts[0];
  };
  const setCookie = (req, res, name, value, days) => res.cookie(name, value, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: days * DAY, path: '/' });

  const html = fs.readFileSync(distFile, 'utf8').replace(/<head[^>]*>/i, m => `${m}<script src="/runtime.js"></script>`);
  const doorHtml = fs.readFileSync(path.join(__dirname, 'door.html'), 'utf8');
  const runtimeJs = fs.readFileSync(path.join(__dirname, 'runtime.js'), 'utf8');
  const fails = new Map();

  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
    next();
  });

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  /* ---- the door: nothing below it is reachable without the shared password ---- */
  app.get('/door', (req, res) => res.type('html').send(doorHtml));
  app.post('/door', express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    const f = fails.get(req.ip);
    if (f && f.until > Date.now()) return res.redirect(303, '/door?khoa=1');
    if (!sameHash(String((req.body && req.body.password) || ''), doorPassword)) {
      const n = (f && !f.until ? f.n : 0) + 1;
      fails.set(req.ip, { n, until: n >= DOOR_MAX_FAILS ? Date.now() + DOOR_LOCK_MS : 0 });
      return res.redirect(303, '/door?sai=1');
    }
    fails.delete(req.ip);
    setCookie(req, res, 'gvg_door', sign('door', 'in', DOOR_DAYS), DOOR_DAYS);
    res.redirect(303, '/');
  });
  app.use((req, res, next) => {
    if (unsign('door', parseCookies(req).gvg_door)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'door' });
    res.redirect(303, '/door');
  });

  app.get('/', (req, res) => res.type('html').send(html));
  app.get('/runtime.js', (req, res) => res.type('js').send(runtimeJs));

  /* ---- sign-in: the browser proves who it is with tokens derived from the data keys (see runtime.js) ---- */
  const api = express.Router();
  api.use(express.json({ limit: '512kb' }));
  api.use((req, res, next) => { req.role = unsign('session', parseCookies(req).gvg_sess); next(); });

  api.post('/login', async (req, res) => {
    const { who, tokens } = req.body || {};
    if (typeof who !== 'string' || !tokens || typeof tokens !== 'object' || !TOKEN.test(tokens[who])) return res.status(400).json({ error: 'Dữ liệu đăng nhập không hợp lệ' });
    if (!await store.isEnrolled()) {
      if (who !== 'owner') return res.status(409).json({ error: 'Chủ cửa hàng cần đăng nhập lần đầu trước' });
      const cfg = await store.getDoc('cfg/main');
      const ids = ['owner', ...((cfg && cfg.staff) || []).map(s => s.id)];
      if (!cfg || !ids.every(id => TOKEN.test(tokens[id]))) return res.status(400).json({ error: 'Dữ liệu đăng nhập không hợp lệ' });
      await store.enroll(Object.fromEntries(ids.map(id => [id, sha256(tokens[id]).toString('hex')])));
    }
    const hash = await store.getTokenHash(who);
    if (!hash || !sameHash(hash, sha256(tokens[who]).toString('hex'))) return res.status(403).json({ error: 'Máy chủ từ chối đăng nhập' });
    setCookie(req, res, 'gvg_sess', sign('session', who, SESSION_DAYS), SESSION_DAYS);
    res.json({ who });
  });
  api.post('/logout', (req, res) => { res.clearCookie('gvg_sess', { path: '/' }); res.status(204).end(); });

  /* ---- docs ---- */
  api.get('/doc', async (req, res) => {
    const p = String(req.query.path);
    if (!parsePath(p)) return res.status(400).json({ error: 'Đường dẫn không hợp lệ' });
    if (!canRead(req.role, p)) return res.status(403).json({ error: 'Không có quyền xem' });
    const data = await store.getDoc(p);
    res.json({ exists: data !== null, data });
  });
  api.put('/doc', async (req, res) => {
    const p = String(req.query.path);
    if (!parsePath(p)) return res.status(400).json({ error: 'Đường dẫn không hợp lệ' });
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    const hasCfg = req.role ? true : (await store.getDoc('cfg/main')) !== null;
    if (!canWrite(req.role, p, { hasCfg })) return res.status(403).json({ error: 'Không có quyền lưu' });
    await store.setDoc(p, req.body);
    res.status(204).end();
  });
  app.use('/api', api);

  app.use((req, res) => res.status(404).type('text').send('Không tìm thấy'));
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Dữ liệu quá lớn' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    console.error(err);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  });
  return app;
}

module.exports = { createApp };

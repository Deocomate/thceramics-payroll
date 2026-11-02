const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { parsePath, canRead, canWrite } = require('./rules');

const DAY = 24 * 3600 * 1000;
const SESSION_DAYS = 180, UNREMEMBERED_DAYS = 1;
const MAX_FAILS = 10, LOCK_MS = 15 * 60 * 1000, MAX_TRACKED = 10000;
const PROOF = /^[0-9a-f]{64}$/;
const SALT = /^[A-Za-z0-9+/]{22}==$/;
const USERNAME = /^[a-z0-9._@-]{2,64}$/;
const ACCOUNT = /^(?:owner|nv\d+)$/;
const ADMIN = 'admin';

const sha256 = s => crypto.createHash('sha256').update(s).digest();
const sha256Hex = s => sha256(s).toString('hex');
const sameHash = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));
const normalizeUsername = s => String(s || '').trim().toLowerCase();

/* must match proofOf() in runtime.js, which is what the browser sends instead of the password */
const passwordProof = (password, salt) => crypto.pbkdf2Sync(password, Buffer.concat([Buffer.from('gvg-auth:'), Buffer.from(salt, 'base64')]), 210000, 32, 'sha256').toString('hex');

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function createApp({ store, secret, adminUsername, adminPassword, distFile, trustProxy }) {
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);

  const key = sha256(secret);
  const hmac = v => crypto.createHmac('sha256', key).update(v).digest();
  /* the proof hash is part of what is signed, so a new password ends that person's sessions on every device */
  const mac = (stamp, v) => hmac('session:' + stamp + ':' + v).toString('hex');
  const sign = (stamp, who, days) => { const v = `${who}.${Date.now() + days * DAY}`; return `${v}.${mac(stamp, v)}`; };
  const unsign = (stamp, cookie) => {
    const parts = String(cookie || '').split('.');
    if (parts.length !== 3) return null;
    const v = parts[0] + '.' + parts[1];
    if (!sameHash(mac(stamp, v), parts[2]) || Number(parts[1]) < Date.now()) return null;
    return parts[0];
  };
  const setSession = (req, res, who, stamp, keep) => {
    const days = keep ? SESSION_DAYS : UNREMEMBERED_DAYS;
    res.cookie('gvg_sess', sign(stamp, who, days), { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: days * DAY, path: '/' });
  };

  /* an unknown name gets a stable salt too, so the salt does not tell who has an account */
  const derivedSalt = username => hmac('salt:' + username).subarray(0, 16).toString('base64');
  const adminName = normalizeUsername(adminUsername);
  const adminHash = sha256Hex(passwordProof(adminPassword, derivedSalt(adminName)));
  /* wraps the data keys for the super admin; never changes with a password, only with SESSION_SECRET */
  const recoveryKey = hmac('recovery-key').toString('hex');

  const html = fs.readFileSync(distFile, 'utf8').replace(/<head[^>]*>/i, m => `${m}<script src="/runtime.js"></script>`);
  const runtimeJs = fs.readFileSync(path.join(__dirname, 'runtime.js'), 'utf8');
  const fails = new Map();

  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
    next();
  });

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/', (req, res) => res.type('html').send(html));
  app.get('/runtime.js', (req, res) => res.type('js').send(runtimeJs));

  const api = express.Router();
  api.use(express.json({ limit: '512kb' }));
  api.use(async (req, res, next) => {
    try {
      const cookie = parseCookies(req).gvg_sess, who = String(cookie || '').split('.')[0];
      const stamp = who === ADMIN ? adminHash : ACCOUNT.test(who) ? (await store.getAccount(who))?.proof_hash : null;
      req.who = stamp ? unsign(stamp, cookie) : null;
      req.role = req.who === ADMIN ? 'owner' : req.who;
      next();
    } catch (e) { next(e); }
  });

  /* ---- sign-in: the browser fetches the salt, then proves the password without sending it (see runtime.js) ---- */
  api.post('/salt', async (req, res) => {
    const username = normalizeUsername(req.body && req.body.username);
    const account = username === adminName ? null : await store.findAccount(username);
    res.json({ salt: account ? account.salt : derivedSalt(username) });
  });

  api.post('/login', async (req, res) => {
    const { proof, keep } = req.body || {};
    const username = normalizeUsername(req.body && req.body.username);
    if (!USERNAME.test(username) || !PROOF.test(proof)) return res.status(400).json({ error: 'Dữ liệu đăng nhập không hợp lệ' });
    const failKey = req.ip + '|' + username, f = fails.get(failKey);
    if (f && f.until > Date.now()) return res.status(429).json({ error: 'Thử sai nhiều lần. Đợi 15 phút rồi nhập lại.' });
    const account = username === adminName ? { who: ADMIN, proof_hash: adminHash } : await store.findAccount(username);
    if (!account || !sameHash(account.proof_hash, sha256Hex(proof))) {
      const n = (f && !f.until ? f.n : 0) + 1;
      if (fails.size >= MAX_TRACKED) fails.clear();   // the key holds a name of the caller's choosing, so this map must not grow forever
      fails.set(failKey, { n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
      return res.status(403).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
    }
    fails.delete(failKey);
    setSession(req, res, account.who, account.proof_hash, keep === true);
    res.json({ who: account.who });
  });
  api.post('/logout', (req, res) => { res.clearCookie('gvg_sess', { path: '/' }); res.status(204).end(); });
  api.get('/me', (req, res) => res.json({ who: req.who }));

  /* ---- everything below needs a signed-in session ---- */
  api.use((req, res, next) => (req.role ? next() : res.status(401).json({ error: 'Cần đăng nhập' })));

  api.get('/recovery-key', (req, res) => {
    if (req.role !== 'owner') return res.status(403).json({ error: 'Không có quyền' });
    res.json({ key: recoveryKey });
  });

  /* ---- accounts ---- */
  api.get('/accounts', async (req, res) => {
    if (req.role !== 'owner') return res.status(403).json({ error: 'Không có quyền' });
    res.json(await store.listUsernames());
  });
  /* staff change their own password; only the owner and the super admin choose names or touch other accounts */
  api.put('/accounts/:who', async (req, res) => {
    const { who } = req.params, { salt, proof, keep } = req.body || {};
    if (!ACCOUNT.test(who) || !SALT.test(salt) || !PROOF.test(proof)) return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    if (req.role !== 'owner' && req.who !== who) return res.status(403).json({ error: 'Không có quyền lưu' });
    const current = await store.getAccount(who);
    const username = (req.role === 'owner' && normalizeUsername(req.body.username)) || (current && current.username);
    if (!username || !USERNAME.test(username)) return res.status(400).json({ error: 'Tên đăng nhập gồm 2-64 ký tự: chữ thường không dấu, số, dấu . _ @ -' });
    const taken = await store.findAccount(username);
    if (username === adminName || (taken && taken.who !== who)) return res.status(409).json({ error: `Tên đăng nhập "${username}" đã có người dùng` });
    const proofHash = sha256Hex(proof);
    await store.setAccount(who, username, salt, proofHash);
    if (req.who === who) setSession(req, res, who, proofHash, keep === true);
    res.status(204).end();
  });

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
    if (!canWrite(req.role, p)) return res.status(403).json({ error: 'Không có quyền lưu' });
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

module.exports = { createApp, passwordProof, USERNAME };

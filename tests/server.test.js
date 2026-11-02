/* Server rules: sign-in, who may read and write what, the super admin, and importing a backup. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, beforeEach, test } = require('node:test');
const { createApp, passwordProof } = require('../server/app');
const { importBackup } = require('../server/import');
const { canRead, canWrite, parsePath } = require('../server/rules');
const { openStore } = require('../server/store');

const ADMIN = 'quan-tri', ADMIN_PW = 'mat-khau-sieu-quan-tri', SECRET = 's'.repeat(40);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gvg-server-'));
const proof = c => c.repeat(64);
const SALT = Buffer.alloc(16, 7).toString('base64');
const PEOPLE = { owner: ['chu', proof('a')], nv1: ['an', proof('b')], nv2: ['binh', proof('c')] };
const CFG = { v: 1, staff: [{ id: 'nv1' }, { id: 'nv2' }, { id: 'nv3' }] };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
let store, server, base, n = 0;

/* a tiny browser: keeps cookies between calls */
function client() {
  const jar = {};
  const call = async (url, opts = {}) => {
    const headers = { ...opts.headers, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    const r = await fetch(base + url, { redirect: 'manual', ...opts, headers });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'), i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    return r;
  };
  const json = (method, url, data) => call(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return {
    call, jar,
    login: (username, p, keep = true) => json('POST', '/api/login', { username, proof: p, keep }),
    salt: username => json('POST', '/api/salt', { username }),
    account: (who, data) => json('PUT', '/api/accounts/' + who, data),
    get: p => call('/api/doc?path=' + encodeURIComponent(p)),
    put: (p, data) => json('PUT', '/api/doc?path=' + encodeURIComponent(p), data),
  };
}
const signedIn = async who => { const c = client(); await c.login(...PEOPLE[who]); return c; };
const asAdmin = async () => {
  const c = client(), { salt } = await (await c.salt(ADMIN)).json();
  assert.equal((await c.login(ADMIN, passwordProof(ADMIN_PW, salt))).status, 200);
  return c;
};

beforeEach(async () => {
  if (server) await new Promise(r => server.close(r));
  if (store) store.close();
  store = await openStore('file:' + path.join(tmp, `t${n++}.db`));
  for (const [who, [username, p]] of Object.entries(PEOPLE)) await store.setAccount(who, username, SALT, sha(p));
  const dist = path.join(tmp, 'index.html');
  fs.writeFileSync(dist, '<!doctype html><html><head><title>x</title></head><body></body></html>');
  const app = createApp({ store, secret: SECRET, adminUsername: ADMIN, adminPassword: ADMIN_PW, distFile: dist });
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  await new Promise(r => server.close(r));
  store.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}   // Windows may still hold the db file for a moment
});

test('there is no shared door: the page opens, and no data does until you sign in', async () => {
  await store.setDocs({ 'cfg/main': CFG, 'kw/nv1': { salt: 'x' }, 'sal/nv1': { ct: 'x' }, 'months/2026-10': { revenue: 1 } });
  const c = client();
  const page = await c.call('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<head><script src="\/runtime\.js"><\/script>/);
  assert.equal((await c.call('/runtime.js')).status, 200);
  assert.equal((await c.call('/door')).status, 404);
  for (const p of ['cfg/main', 'kw/nv1', 'sal/nv1', 'months/2026-10']) assert.equal((await c.get(p)).status, 401, p);
  assert.equal((await c.put('cfg/main', {})).status, 401);
  assert.equal((await c.call('/api/accounts')).status, 401);
  assert.equal((await c.call('/api/recovery-key')).status, 401);
});

test('the health check answers without signing in and says nothing else', async () => {
  const r = await client().call('/healthz');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test('behind the HTTPS proxy, cookies are marked secure', async () => {
  const dist = path.join(tmp, 'index.html');
  const app = createApp({ store, secret: SECRET, adminUsername: ADMIN, adminPassword: ADMIN_PW, distFile: dist, trustProxy: true });
  const proxied = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const url = 'http://127.0.0.1:' + proxied.address().port + '/api/login';
  const body = JSON.stringify({ username: PEOPLE.nv1[0], proof: PEOPLE.nv1[1] });
  const post = proto => fetch(url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': proto }, body });
  assert.match((await post('https')).headers.get('set-cookie'), /; Secure/);
  assert.doesNotMatch((await post('http')).headers.get('set-cookie'), /; Secure/);
  await new Promise(r => proxied.close(r));
  proxied.closeAllConnections();
});

test('each person signs in with their own name and password', async () => {
  const c = client();
  assert.equal((await c.login('an', proof('e'))).status, 403);
  assert.equal((await c.login('khong-co-ai', proof('e'))).status, 403);
  const ok = await c.login(' AN ', PEOPLE.nv1[1]);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { who: 'nv1' });
  assert.deepEqual(await (await c.call('/api/me')).json(), { who: 'nv1' });
  await c.call('/api/logout', { method: 'POST' });
  assert.deepEqual(await (await c.call('/api/me')).json(), { who: null });
});

test('a login that is not remembered gets a short session', async () => {
  const c = client();
  const long = (await c.login(...PEOPLE.nv1, true)).headers.get('set-cookie');
  const short = (await c.login(...PEOPLE.nv1, false)).headers.get('set-cookie');
  const age = h => Number(/Max-Age=(\d+)/.exec(h)[1]);
  assert.ok(age(short) < age(long));
});

test('session cookies cannot be forged or moved to another person', async () => {
  await store.setDoc('sal/nv2', { ct: 'y' });
  const c = await signedIn('nv1'), mine = c.jar.gvg_sess;
  c.jar.gvg_sess = 'nv2.9999999999999.' + 'a'.repeat(64);
  assert.equal((await c.get('sal/nv2')).status, 401);
  c.jar.gvg_sess = mine.replace(/^nv1/, 'nv2');
  assert.equal((await c.get('sal/nv2')).status, 401);
  c.jar.gvg_sess = mine.replace(/^nv1/, 'admin');
  assert.equal((await c.get('sal/nv2')).status, 401);
});

test('guessing locks that name after repeated failures, not everyone else', async () => {
  const c = client();
  for (let i = 0; i < 10; i++) assert.equal((await c.login('an', proof('e'))).status, 403);
  assert.equal((await c.login(...PEOPLE.nv1)).status, 429);
  assert.equal((await c.login(...PEOPLE.nv2)).status, 200);
});

test('the salt does not reveal who has an account', async () => {
  const c = client();
  assert.deepEqual(await (await c.salt('an')).json(), { salt: SALT });
  const unknown = await (await c.salt('khong-co-ai')).json();
  assert.match(unknown.salt, /^[A-Za-z0-9+/]{22}==$/);
  assert.deepEqual(await (await c.salt('khong-co-ai')).json(), unknown);
  assert.match((await (await c.salt(ADMIN)).json()).salt, /^[A-Za-z0-9+/]{22}==$/);
});

test('first-time setup belongs to the super admin alone', async () => {
  assert.equal((await client().put('kw/nv1', { salt: 'x' })).status, 401);
  const admin = await asAdmin();
  assert.equal((await admin.put('kw/nv1', { salt: 'x' })).status, 204);
  assert.equal((await admin.put('cfg/main', CFG)).status, 204);
});

test('the super admin comes from the environment and can do everything the owner can', async () => {
  const admin = await asAdmin();
  assert.deepEqual(await (await admin.call('/api/me')).json(), { who: 'admin' });
  assert.equal((await admin.put('sal/nv1', { ct: 'x' })).status, 204);
  assert.deepEqual(await (await admin.get('sal/nv1')).json(), { exists: true, data: { ct: 'x' } });
  assert.deepEqual(await (await admin.call('/api/accounts')).json(), { owner: 'chu', nv1: 'an', nv2: 'binh' });
  assert.match((await (await admin.call('/api/recovery-key')).json()).key, /^[0-9a-f]{64}$/);
  assert.equal((await admin.account('owner', { username: 'chu-moi', salt: SALT, proof: proof('f') })).status, 204);
  assert.equal((await client().login('chu', PEOPLE.owner[1])).status, 403);
  assert.equal((await client().login('chu-moi', proof('f'))).status, 200);
  assert.equal(await store.findAccount(ADMIN), null);
});

test('changing the admin password in the environment keeps the recovery key', async () => {
  const before = await (await (await asAdmin()).call('/api/recovery-key')).json();
  const NEW_PW = 'mat-khau-admin-moi-hon';
  const app = createApp({ store, secret: SECRET, adminUsername: ADMIN, adminPassword: NEW_PW, distFile: path.join(tmp, 'index.html') });
  const other = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const url = 'http://127.0.0.1:' + other.address().port;
  const post = (p, data) => fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const { salt } = await (await post('/api/salt', { username: ADMIN })).json();
  const login = await post('/api/login', { username: ADMIN, proof: passwordProof(NEW_PW, salt) });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  assert.deepEqual(await (await fetch(url + '/api/recovery-key', { headers: { cookie } })).json(), before);
  assert.equal((await post('/api/login', { username: ADMIN, proof: passwordProof(ADMIN_PW, salt) })).status, 403);
  await new Promise(r => other.close(r));
  other.closeAllConnections();
});

test('only the owner and the super admin see accounts and the recovery key', async () => {
  const staff = await signedIn('nv1');
  assert.equal((await staff.call('/api/accounts')).status, 403);
  assert.equal((await staff.call('/api/recovery-key')).status, 403);
  const owner = await signedIn('owner');
  assert.equal((await owner.call('/api/accounts')).status, 200);
  assert.equal((await owner.call('/api/recovery-key')).status, 200);
});

test('a new password ends the sessions on other devices and keeps this one', async () => {
  await store.setDoc('sd/nv1_2026-10', { ct: 'x' });
  const here = await signedIn('nv1'), there = await signedIn('nv1');
  assert.equal((await here.account('nv1', { salt: SALT, proof: proof('f'), keep: true })).status, 204);
  assert.equal((await here.get('sd/nv1_2026-10')).status, 200);
  assert.equal((await there.get('sd/nv1_2026-10')).status, 401);
  assert.equal((await client().login('an', PEOPLE.nv1[1])).status, 403);
  assert.equal((await client().login('an', proof('f'))).status, 200);
});

test('resetting a former employee shuts them out at once', async () => {
  await store.setDoc('sd/nv1_2026-10', { ct: 'x' });
  const leaver = await signedIn('nv1'), owner = await signedIn('owner');
  assert.equal((await owner.account('nv1', { username: 'an', salt: SALT, proof: proof('f') })).status, 204);
  assert.equal((await leaver.get('sd/nv1_2026-10')).status, 401);
});

test('staff cannot rename themselves or touch anyone else', async () => {
  const c = await signedIn('nv1');
  assert.equal((await c.account('nv2', { salt: SALT, proof: proof('f') })).status, 403);
  assert.equal((await c.account('owner', { salt: SALT, proof: proof('f') })).status, 403);
  assert.equal((await c.account('nv1', { username: 'ten-moi', salt: SALT, proof: proof('b'), keep: true })).status, 204);
  assert.equal((await store.getAccount('nv1')).username, 'an');
});

test('usernames stay unique and well formed', async () => {
  const owner = await signedIn('owner'), good = { salt: SALT, proof: proof('f') };
  assert.equal((await owner.account('nv1', { ...good, username: 'binh' })).status, 409);
  assert.equal((await owner.account('nv1', { ...good, username: ADMIN })).status, 409);
  assert.equal((await owner.account('nv1', { ...good, username: 'a b' })).status, 400);
  assert.equal((await owner.account('nv3', good)).status, 400);
  assert.equal((await owner.account('admin', { ...good, username: 'x12' })).status, 400);
  assert.equal((await owner.account('nv1', { ...good, proof: 'ngan', username: 'an' })).status, 400);
  assert.equal((await owner.account('nv1', { ...good, salt: 'x', username: 'an' })).status, 400);
  assert.equal((await owner.account('nv1', { ...good, username: 'An.Nguyen' })).status, 204);
  assert.equal((await store.getAccount('nv1')).username, 'an.nguyen');
});

test('staff write only their own timesheet, bank details and password wrap', async () => {
  await store.setDocs({ 'cfg/main': CFG, 'sal/nv2': { ct: 'y' }, 'kw/nv2': { salt: 'y' } });
  const c = await signedIn('nv1');
  for (const p of ['sd/nv1_2026-10', 'sp/nv1', 'kw/nv1']) assert.equal((await c.put(p, { ct: 'x' })).status, 204, p);
  for (const p of ['sal/nv1', 'bon/nv1_2026-10', 'months/2026-10', 'cfg/main', 'sd/nv2_2026-10', 'kw/nv2', 'sp/nv2']) assert.equal((await c.put(p, { ct: 'x' })).status, 403, p);
  assert.equal((await c.get('sal/nv2')).status, 403);
  assert.equal((await c.get('kw/nv2')).status, 403);
  assert.equal((await c.get('cfg/main')).status, 200);
});

test('the owner reads and writes everything, and sign-out ends that', async () => {
  await store.setDoc('cfg/main', CFG);
  const c = await signedIn('owner');
  assert.equal((await c.put('sal/nv1', { ct: 'x' })).status, 204);
  assert.deepEqual(await (await c.get('sal/nv1')).json(), { exists: true, data: { ct: 'x' } });
  assert.deepEqual(await (await c.get('sal/nv2')).json(), { exists: false, data: null });
  await c.call('/api/logout', { method: 'POST' });
  assert.equal((await c.put('sal/nv1', { ct: 'y' })).status, 401);
});

test('bad paths and bodies are refused', async () => {
  const c = await signedIn('owner');
  assert.equal((await c.get('../../sal/nv1')).status, 400);
  assert.equal((await c.put('sal/nv1/x', {})).status, 400);
  assert.equal((await c.put('sal/nv1', [1])).status, 400);
  const bad = await c.call('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(bad.status, 400);
  assert.equal((await c.login('a', proof('a'))).status, 400);
  assert.equal((await c.login('an', 'ngan')).status, 400);
  const big = await c.put('sal/nv1', { ct: 'x'.repeat(600 * 1024) }).catch(() => null);   // the server may hang up before reading it all
  assert.ok(!big || big.status === 413);
  assert.equal(await store.getDoc('sal/nv1'), null);
});

test('importing a backup loads it and refuses to overwrite by accident', async () => {
  const backup = { v: 1, docs: { 'cfg/main': CFG, 'sal/nv1': { ct: 'x' } } };
  assert.equal(await importBackup(store, backup), 2);
  assert.deepEqual(await store.getDoc('sal/nv1'), { ct: 'x' });
  await assert.rejects(importBackup(store, backup), /đã có dữ liệu/);
  assert.equal(await importBackup(store, backup, { force: true }), 2);
  await assert.rejects(importBackup(store, { docs: {} }), /cfg\/main/);
  await assert.rejects(importBackup(store, { docs: { 'cfg/main': CFG, 'etc/x': {} } }), /đường dẫn lạ/);
});

test('rules accept every path the app uses', () => {
  for (const p of ['cfg/main', 'kw/nv1', 'sal/nv1', 'sp/nv3', 'sd/nv1_2026-10', 'bon/nv2_2026-10', 'months/2026-10']) assert.ok(parsePath(p), p);
  assert.equal(canRead('nv1', 'sd/nv2_2026-10'), false);
  assert.equal(canWrite('nv1', 'sd/nv1_2026-10'), true);
  assert.equal(canRead(null, 'cfg/main'), false);
  assert.equal(canWrite(null, 'cfg/main'), false);
});

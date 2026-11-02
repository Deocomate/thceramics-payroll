/* Server rules: door, sign-in, who may read and write what, and importing a backup. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, beforeEach, test } = require('node:test');
const { createApp } = require('../server/app');
const { importBackup } = require('../server/import');
const { canRead, canWrite, parsePath } = require('../server/rules');
const { openStore } = require('../server/store');

const DOOR = 'cua-hang-123';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gvg-server-'));
const token = c => c.repeat(64);
const TOKENS = { owner: token('a'), nv1: token('b'), nv2: token('c'), nv3: token('d') };
const CFG = { v: 1, staff: [{ id: 'nv1' }, { id: 'nv2' }, { id: 'nv3' }] };
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
  return {
    call,
    door: pw => call('/door', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(pw) }),
    login: (who, tokens) => call('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ who, tokens }) }),
    get: p => call('/api/doc?path=' + encodeURIComponent(p)),
    put: (p, data) => call('/api/doc?path=' + encodeURIComponent(p), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  };
}
const inside = async () => { const c = client(); await c.door(DOOR); return c; };

beforeEach(async () => {
  if (server) await new Promise(r => server.close(r));
  if (store) store.close();
  store = await openStore('file:' + path.join(tmp, `t${n++}.db`));
  const dist = path.join(tmp, 'index.html');
  fs.writeFileSync(dist, '<!doctype html><html><head><title>x</title></head><body></body></html>');
  const app = createApp({ store, secret: 's'.repeat(40), doorPassword: DOOR, distFile: dist });
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  await new Promise(r => server.close(r));
  store.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}   // Windows may still hold the db file for a moment
});

test('the door keeps everything else out', async () => {
  const c = client();
  assert.equal((await c.call('/')).headers.get('location'), '/door');
  assert.equal((await c.get('cfg/main')).status, 401);
  assert.equal((await c.door('sai')).headers.get('location'), '/door?sai=1');
  assert.equal((await c.call('/')).status, 303);
  assert.equal((await c.door(DOOR)).headers.get('location'), '/');
  const page = await c.call('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<head><script src="\/runtime\.js"><\/script>/);
  assert.equal((await c.call('/runtime.js')).status, 200);
});

test('the health check answers without the door and says nothing else', async () => {
  const r = await client().call('/healthz');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test('behind the HTTPS proxy, cookies are marked secure', async () => {
  const dist = path.join(tmp, 'index.html');
  const app = createApp({ store, secret: 's'.repeat(40), doorPassword: DOOR, distFile: dist, trustProxy: true });
  const proxied = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const url = 'http://127.0.0.1:' + proxied.address().port + '/door';
  const body = 'password=' + encodeURIComponent(DOOR);
  const post = proto => fetch(url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-Proto': proto }, body });
  assert.match((await post('https')).headers.get('set-cookie'), /; Secure/);
  assert.doesNotMatch((await post('http')).headers.get('set-cookie'), /; Secure/);
  await new Promise(r => proxied.close(r));
  proxied.closeAllConnections();
});

test('door cookies cannot be forged and the door locks after repeated failures', async () => {
  const c = client();
  const forged = await c.call('/', { headers: { cookie: 'gvg_door=in.9999999999999.abcd' } });
  assert.equal(forged.status, 303);
  for (let i = 0; i < 10; i++) await c.door('sai');
  assert.equal((await c.door(DOOR)).headers.get('location'), '/door?khoa=1');
});

test('a door cookie cannot pass as a signed-in session', async () => {
  await store.setDoc('months/2026-10', { revenue: 1 });
  const c = client();
  const door = (await c.door(DOOR)).headers.getSetCookie()[0].split(';')[0].split('=')[1];
  const r = await c.call('/api/doc?path=months%2F2026-10', { headers: { cookie: `gvg_door=${door}; gvg_sess=${door}` } });
  assert.equal(r.status, 403);
});

test('first-time setup can write until cfg/main exists, then nobody signed out can', async () => {
  const c = await inside();
  assert.equal((await c.put('kw/nv1', { salt: 'x' })).status, 204);
  assert.equal((await c.put('cfg/main', CFG)).status, 204);
  assert.equal((await c.put('sal/nv1', { ct: 'x' })).status, 403);
  assert.equal((await c.put('cfg/main', {})).status, 403);
});

test('signed-out visitors read only what the login screen needs', async () => {
  await store.setDocs({ 'cfg/main': CFG, 'kw/nv1': { salt: 'x' }, 'sal/nv1': { ct: 'x' }, 'months/2026-10': { revenue: 1 } });
  const c = await inside();
  assert.equal((await c.get('cfg/main')).status, 200);
  assert.equal((await c.get('kw/nv1')).status, 200);
  assert.equal((await c.get('sal/nv1')).status, 403);
  assert.equal((await c.get('months/2026-10')).status, 403);
});

test('the owner enrols everyone at first sign-in; staff must wait for that', async () => {
  await store.setDoc('cfg/main', CFG);
  const staff = await inside();
  assert.equal((await staff.login('nv1', { nv1: TOKENS.nv1 })).status, 409);
  const owner = await inside();
  assert.equal((await owner.login('owner', { owner: TOKENS.owner, nv1: TOKENS.nv1 })).status, 400);
  assert.equal((await owner.login('owner', TOKENS)).status, 200);
  assert.equal((await staff.login('nv1', { nv1: TOKENS.nv1 })).status, 200);
  const other = await inside();
  assert.equal((await other.login('owner', { ...TOKENS, owner: token('e') })).status, 403);
  assert.equal((await other.login('nv2', { nv2: TOKENS.nv1 })).status, 403);
  assert.equal(await store.getTokenHash('owner'), crypto.createHash('sha256').update(TOKENS.owner).digest('hex'));
});

test('concurrent first sign-ins cannot replace the enrolled tokens', async () => {
  await store.setDoc('cfg/main', CFG);
  const results = await Promise.all([{ ...TOKENS }, { ...TOKENS, owner: token('e') }].map(async t => (await (await inside()).login('owner', t)).status));
  assert.deepEqual(results.sort(), [200, 403]);
});

test('staff write only their own timesheet, bank details and password wrap', async () => {
  await store.setDocs({ 'cfg/main': CFG, 'sal/nv2': { ct: 'y' } });
  await (await inside()).login('owner', TOKENS);
  const c = await inside();
  await c.login('nv1', { nv1: TOKENS.nv1 });
  for (const p of ['sd/nv1_2026-10', 'sp/nv1', 'kw/nv1']) assert.equal((await c.put(p, { ct: 'x' })).status, 204, p);
  for (const p of ['sal/nv1', 'bon/nv1_2026-10', 'months/2026-10', 'cfg/main', 'sd/nv2_2026-10', 'kw/nv2', 'sp/nv2']) assert.equal((await c.put(p, { ct: 'x' })).status, 403, p);
  assert.equal((await c.get('sal/nv2')).status, 403);
});

test('the owner reads and writes everything, and sign-out ends that', async () => {
  await store.setDoc('cfg/main', CFG);
  const c = await inside();
  await c.login('owner', TOKENS);
  assert.equal((await c.put('sal/nv1', { ct: 'x' })).status, 204);
  assert.deepEqual(await (await c.get('sal/nv1')).json(), { exists: true, data: { ct: 'x' } });
  assert.deepEqual(await (await c.get('sal/nv2')).json(), { exists: false, data: null });
  await c.call('/api/logout', { method: 'POST' });
  assert.equal((await c.put('sal/nv1', { ct: 'y' })).status, 403);
});

test('bad paths and bodies are refused', async () => {
  const c = await inside();
  assert.equal((await c.get('../../sal/nv1')).status, 400);
  assert.equal((await c.put('sal/nv1/x', {})).status, 400);
  await store.setDoc('cfg/main', CFG);
  await c.login('owner', TOKENS);
  assert.equal((await c.put('sal/nv1', [1])).status, 400);
  const bad = await c.call('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(bad.status, 400);
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
  assert.equal(canWrite('nv1', 'sd/nv1_2026-10', { hasCfg: true }), true);
});

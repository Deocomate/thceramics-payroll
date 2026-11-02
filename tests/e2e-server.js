/* The real page on the real server, no mock runtime: door, setup, sign-in, write rules, backup, and moving to a second server. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { createApp } = require('../server/app');
const { importBackup } = require('../server/import');
const { openStore } = require('../server/store');

const DOOR = 'cua-hang-123', OPW = 'chu-cua-hang', PW = ['staff-one', 'staff-two', 'staff-three'];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gvg-e2e-'));
const distFile = path.join(__dirname, '..', 'dist', 'index.html');

async function startServer(name) {
  const store = await openStore('file:' + path.join(tmp, name + '.db'));
  const app = createApp({ store, secret: 's'.repeat(40), doorPassword: DOOR, distFile });
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { store, server, url: 'http://127.0.0.1:' + server.address().port };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  /* a new device: its own cookies and remembered login */
  const device = async url => {
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1240, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(url);
    return p;
  };
  const enterDoor = async p => {
    await p.fill('#password', DOOR);
    await p.click('button[type=submit]');
  };
  const signIn = async (p, who, pw) => {
    await p.waitForSelector('.whogrid');
    await p.click(`[data-act=pickWho][data-id=${who}]`);
    await p.fill('#pw', pw);
    await p.click('#loginForm [type=submit]');
    await p.waitForSelector('.top');
    await p.waitForFunction(() => !S.loading);
  };

  const A = await startServer('a');

  /* ---- door ---- */
  const p = await device(A.url);
  assert.ok(p.url().endsWith('/door'));
  await p.fill('#password', 'sai-mat-khau');
  await p.click('button[type=submit]');
  await p.waitForFunction(() => document.querySelector('#msg').textContent === 'Sai mật khẩu.');
  await enterDoor(p);

  /* ---- first-time setup, then the owner's first sign-in enrols everyone ---- */
  await p.waitForSelector('#setupForm');
  await p.fill('[name=opw]', OPW);
  await p.fill('[name=opw2]', OPW);
  for (let i = 0; i < 3; i++) await p.fill(`[name=pw${i}]`, PW[i]);
  await p.click('#setupForm [type=submit]');
  await signIn(p, 'owner', OPW);
  assert.ok(await A.store.isEnrolled());

  await p.evaluate(() => mutateDays('nv1', days => { days['01'] = { st: 'work' }; days['02'] = { st: 'half' }; }));
  assert.strictEqual(await p.evaluate(() => calcPay('nv1').cong), 1.5);

  /* a reload stays signed in and reads the data back from the server */
  await p.reload();
  await p.waitForSelector('.top');
  await p.waitForFunction(() => !S.loading);
  assert.strictEqual(await p.evaluate(() => calcPay('nv1').cong), 1.5);

  /* a new owner password keeps server sign-in working */
  await p.click('[data-act=tab][data-v=cd]');
  const NEW_OPW = 'chu-cua-hang-2';
  await p.fill('#opwForm [name=p1]', NEW_OPW);
  await p.fill('#opwForm [name=p2]', NEW_OPW);
  await p.click('#opwForm [type=submit]');
  await p.waitForSelector('#toast :text("Đã đổi mật khẩu chủ")');

  /* ---- backup holds everything, encrypted ---- */
  const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=backupAll]')]);
  assert.match(download.suggestedFilename(), /^gom-vu-gia-sao-luu-\d{4}-\d{2}\.json$/);
  const text = fs.readFileSync(await download.path(), 'utf8');
  const backup = JSON.parse(text);
  for (const k of ['cfg/main', 'kw/nv1', 'sal/nv1', 'sp/nv1']) assert.ok(backup.docs[k], k);
  assert.ok(Object.keys(backup.docs).some(k => k.startsWith('sd/nv1_')));
  for (const secret of ['staff-one', OPW, '"st"']) assert.ok(!text.includes(secret), secret);

  /* ---- staff: own data only, and the server refuses what the app would never send ---- */
  const staffOne = await device(A.url);
  await enterDoor(staffOne);
  await staffOne.waitForSelector('.whogrid');
  await staffOne.click('[data-act=pickWho][data-id=nv1]');
  await staffOne.fill('#pw', 'sai');
  await staffOne.click('#loginForm [type=submit]');
  await staffOne.waitForSelector('#toast :text("Sai mật khẩu")');
  await staffOne.fill('#pw', PW[0]);
  await staffOne.click('#loginForm [type=submit]');
  await staffOne.waitForSelector('.top');
  await staffOne.waitForFunction(() => !S.loading);
  assert.strictEqual(await staffOne.evaluate(() => calcPay('nv1').cong), 1.5);
  await staffOne.evaluate(() => mutateDays('nv1', days => { days['03'] = { st: 'work' }; }));
  assert.strictEqual(await staffOne.evaluate(() => calcPay('nv1').cong), 2.5);
  const refused = await staffOne.evaluate(async () => {
    const tryIt = async fn => { try { await fn(); return 'saved'; } catch (e) { return e.code; } };
    return {
      ownSalary: await tryIt(() => putEnc(P.sal('nv1'), 'nv1', { monthly: 99000000 })),
      ownBonus: await tryIt(() => putEnc(P.bon('nv1', S.ym), 'nv1', { items: [{ type: 'bonus', amt: 99000000 }] })),
      month: await tryIt(() => dset(P.month(S.ym), { revenue: 1 })),
      config: await tryIt(() => dset('cfg/main', {})),
      readOther: await tryIt(() => dget(P.sal('nv2'))),
    };
  });
  assert.deepStrictEqual(refused, { ownSalary: 403, ownBonus: 403, month: 403, config: 403, readOther: 403 });

  /* a staff password change needs nothing from the server, and sign-out ends the session */
  await staffOne.evaluate(() => rewrapStaff('nv1', 'staff-one-new'));
  await staffOne.click('[data-act=logout]');
  await staffOne.waitForSelector('.whogrid');
  const after = await staffOne.evaluate(() => fetch('/api/doc?path=sd/nv1_2026-10').then(r => r.status));
  assert.strictEqual(after, 403);
  await signIn(staffOne, 'nv1', 'staff-one-new');
  assert.strictEqual(await staffOne.evaluate(() => calcPay('nv1').cong), 2.5);

  /* ---- moving to a new server: same passwords as when the backup was made, and the first owner sign-in enrols again ---- */
  const B = await startServer('b');
  await importBackup(B.store, backup);
  const moved = await device(B.url);
  await enterDoor(moved);
  await signIn(moved, 'owner', NEW_OPW);
  assert.strictEqual(await moved.evaluate(() => calcPay('nv1').cong), 1.5);
  assert.ok(await B.store.isEnrolled());
  const movedStaff = await device(B.url);
  await enterDoor(movedStaff);
  await signIn(movedStaff, 'nv2', PW[1]);
  await movedStaff.evaluate(() => mutateDays('nv2', days => { days['02'] = { st: 'work' }; }));
  assert.strictEqual(await movedStaff.evaluate(() => calcPay('nv2').cong), 1);

  assert.deepStrictEqual(errors, []);
  await browser.close();
  for (const { server, store } of [A, B]) { await new Promise(r => server.close(r)); store.close(); }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log('Server E2E OK');
})().catch(e => { console.error(e); process.exit(1); });

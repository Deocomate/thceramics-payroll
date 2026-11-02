/* The real page on the real server, no mock runtime: super admin, setup, sign-in, write rules, recovery, backup, and moving to a second server. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { createApp } = require('../server/app');
const { importBackup } = require('../server/import');
const { openStore } = require('../server/store');

const ADMIN = 'admin', ADMIN_PW = 'mat-khau-sieu-quan-tri', OPW = 'chu-cua-hang', PW = ['staff-one', 'staff-two', 'staff-three'];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gvg-e2e-'));
const distFile = path.join(__dirname, '..', 'dist', 'index.html');

async function startServer(name, secret) {
  const store = await openStore('file:' + path.join(tmp, name + '.db'));
  const app = createApp({ store, secret, adminUsername: ADMIN, adminPassword: ADMIN_PW, distFile });
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { store, server, url: 'http://127.0.0.1:' + server.address().port };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  /* a new device: its own cookies and remembered login */
  const device = async url => {
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1240, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());   // the page's only outside request; a slow network must not fail this test
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(url);
    return p;
  };
  const submitLogin = async (p, username, pw) => {
    await p.waitForSelector('#loginForm');
    await p.fill('#user', username);
    await p.fill('#pw', pw);
    await p.click('#loginForm [type=submit]');
  };
  const ready = async p => {
    await p.waitForSelector('.top');
    await p.waitForFunction(() => !S.loading);
  };
  const signIn = async (p, username, pw) => { await submitLogin(p, username, pw); await ready(p); };

  const A = await startServer('a', 's'.repeat(40));

  /* ---- no shared door: a form asking who you are, and no staff names before signing in ---- */
  const p = await device(A.url);
  await p.waitForSelector('#loginForm');
  assert.strictEqual(await p.locator('.whogrid').count(), 0);
  await submitLogin(p, ADMIN, 'sai-mat-khau-admin');
  await p.waitForSelector('#toast :text("Sai tên đăng nhập hoặc mật khẩu")');

  /* ---- the super admin from the environment does the first-time setup and lands in the app ---- */
  await submitLogin(p, ADMIN, ADMIN_PW);
  await p.waitForSelector('#setupForm');
  await p.fill('[name=opw]', OPW);
  await p.fill('[name=opw2]', OPW);
  for (let i = 0; i < 3; i++) await p.fill(`[name=pw${i}]`, PW[i]);
  await p.fill('[name=u1]', 'nv1');
  await p.click('#setupForm [type=submit]');
  await p.waitForSelector('#toast :text("Mỗi người cần một tên đăng nhập khác nhau")');
  await p.fill('[name=u1]', 'nv2');
  await p.click('#setupForm [type=submit]');
  await ready(p);
  assert.strictEqual(await p.locator('.who b').textContent(), 'Super admin');
  assert.strictEqual((await A.store.findAccount('nv3')).who, 'nv3');

  await p.evaluate(() => mutateDays('nv1', days => { days['01'] = { st: 'work' }; days['02'] = { st: 'half' }; }));
  assert.strictEqual(await p.evaluate(() => calcPay('nv1').cong), 1.5);

  /* a reload stays signed in and reads the data back from the server */
  await p.reload();
  await ready(p);
  assert.strictEqual(await p.evaluate(() => calcPay('nv1').cong), 1.5);
  await p.click('[data-act=logout]');
  await p.waitForSelector('#loginForm');

  /* ---- the owner signs in with their own account ---- */
  const owner = await device(A.url);
  await signIn(owner, 'chu', OPW);
  assert.strictEqual(await owner.locator('.who b').textContent(), 'Chủ cửa hàng');
  assert.strictEqual(await owner.evaluate(() => calcPay('nv1').cong), 1.5);

  /* ---- backup holds everything, encrypted ---- */
  await owner.click('[data-act=tab][data-v=cd]');
  const [download] = await Promise.all([owner.waitForEvent('download'), owner.click('[data-act=backupAll]')]);
  assert.match(download.suggestedFilename(), /^gom-vu-gia-sao-luu-\d{4}-\d{2}\.json$/);
  const text = fs.readFileSync(await download.path(), 'utf8');
  const backup = JSON.parse(text);
  for (const k of ['cfg/main', 'kw/nv1', 'sal/nv1', 'sp/nv1']) assert.ok(backup.docs[k], k);
  assert.ok(Object.keys(backup.docs).some(k => k.startsWith('sd/nv1_')));
  for (const secret of ['staff-one', OPW, ADMIN_PW, '"st"']) assert.ok(!text.includes(secret), secret);

  /* ---- staff: own data only, and the server refuses what the app would never send ---- */
  const staffOne = await device(A.url);
  await submitLogin(staffOne, 'nv1', 'sai');
  await staffOne.waitForSelector('#toast :text("Sai tên đăng nhập hoặc mật khẩu")');
  await signIn(staffOne, 'nv1', PW[0]);
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
      recovery: await tryIt(() => S.user.recoveryKey()),
    };
  });
  assert.deepStrictEqual(refused, { ownSalary: 403, ownBonus: 403, month: 403, config: 403, readOther: 403, recovery: 403 });

  /* a staff password change keeps this device signed in, and sign-out ends the session */
  await staffOne.evaluate(() => rewrapStaff('nv1', 'staff-one-new'));
  await staffOne.reload();
  await ready(staffOne);
  assert.strictEqual(await staffOne.evaluate(() => calcPay('nv1').cong), 2.5);
  await staffOne.click('[data-act=logout]');
  await staffOne.waitForSelector('#loginForm');
  const signedOut = await staffOne.evaluate(() => fetch('/api/doc?path=sd/nv1_2026-10').then(r => r.status));
  assert.strictEqual(signedOut, 401);
  await signIn(staffOne, 'nv1', 'staff-one-new');
  assert.strictEqual(await staffOne.evaluate(() => calcPay('nv1').cong), 2.5);

  /* ---- the owner forgot the password: the super admin opens the data and sets a new one ---- */
  const FORGOTTEN_FIX = 'chu-cua-hang-moi';
  await p.reload();
  await signIn(p, ADMIN, ADMIN_PW);
  await p.click('[data-act=tab][data-v=cd]');
  await p.fill('#opwForm [name=p1]', FORGOTTEN_FIX);
  await p.fill('#opwForm [name=p2]', FORGOTTEN_FIX);
  await p.click('#opwForm [type=submit]');
  await p.waitForSelector('#toast :text("Đã đổi mật khẩu chủ")');
  await p.reload();
  await ready(p);
  assert.strictEqual(await p.locator('.who b').textContent(), 'Super admin');
  const ownerAgain = await device(A.url);
  await signIn(ownerAgain, 'chu', FORGOTTEN_FIX);
  assert.strictEqual(await ownerAgain.evaluate(() => calcPay('nv1').cong), 2.5);

  /* the owner's old device was signed out by the new password, and is sent back to the sign-in form */
  await owner.evaluate(() => { dget('sal/nv1').catch(() => {}); });
  await owner.waitForSelector('#loginForm');

  /* a staff member who forgot theirs gets a new one, and a taken name is refused before anything changes */
  await p.click('[data-act=tab][data-v=cd]');
  await p.click('[data-act=resetPw][data-id=nv2]');
  await p.fill('#resetForm [name=username]', 'chu');
  await p.fill('#resetForm [name=p]', 'staff-two-new');
  await p.click('#resetForm [type=submit]');
  await p.waitForSelector('#toast :text("đã có người dùng")');
  await p.fill('#resetForm [name=username]', 'binh');
  await p.click('#resetForm [type=submit]');
  await p.waitForSelector('#toast :text("Đã đặt lại mật khẩu")');
  const staffTwo = await device(A.url);
  await signIn(staffTwo, 'binh', 'staff-two-new');

  /* ---- moving to a new server with another secret: the owner password unlocks once, then accounts are made again ---- */
  const B = await startServer('b', 'x'.repeat(40));
  await importBackup(B.store, backup);
  const moved = await device(B.url);
  await submitLogin(moved, 'chu', OPW);
  await moved.waitForSelector('#toast :text("Sai tên đăng nhập hoặc mật khẩu")');
  await submitLogin(moved, ADMIN, ADMIN_PW);
  await moved.waitForSelector('#ownerGateForm');
  await moved.fill('#pw', 'sai');
  await moved.click('#ownerGateForm [type=submit]');
  await moved.waitForSelector('#toast :text("Sai mật khẩu")');
  await moved.fill('#pw', OPW);
  await moved.click('#ownerGateForm [type=submit]');
  await ready(moved);
  assert.strictEqual(await moved.evaluate(() => calcPay('nv1').cong), 1.5);
  await moved.waitForSelector('.callout:has-text("Chưa có tài khoản đăng nhập")');
  await moved.click('[data-act=resetPw][data-id=nv2]');
  await moved.fill('#resetForm [name=username]', 'binh');
  await moved.fill('#resetForm [name=p]', PW[1]);
  await moved.click('#resetForm [type=submit]');
  await moved.waitForSelector('#toast :text("Đã đặt lại mật khẩu")');
  const movedStaff = await device(B.url);
  await signIn(movedStaff, 'binh', PW[1]);
  await movedStaff.evaluate(() => mutateDays('nv2', days => { days['02'] = { st: 'work' }; }));
  assert.strictEqual(await movedStaff.evaluate(() => calcPay('nv2').cong), 1);

  /* from now on the super admin needs no owner password here */
  await moved.click('[data-act=logout]');
  await signIn(moved, ADMIN, ADMIN_PW);
  assert.strictEqual(await moved.evaluate(() => calcPay('nv1').cong), 1.5);

  assert.deepStrictEqual(errors, []);
  await browser.close();
  for (const { server, store } of [A, B]) { await new Promise(r => server.close(r)); store.close(); }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log('Server E2E OK');
})().catch(e => { console.error(e); process.exit(1); });

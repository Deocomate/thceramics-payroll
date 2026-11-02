/*
 * End-to-end test (Playwright + Chromium) against dist/index.html with a mocked
 * `window.claude` runtime (tests/mock-runtime.js: in-memory `db`, `user`, `downloads`).
 *
 *   npm i && npx playwright install chromium   # once
 *   npm test                                   # build + run
 *
 * The clock is frozen at 2026-10-30 10:30 (Asia/Bangkok) so results are deterministic.
 * Screenshots are written to tests/out/.
 */
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ timezoneId: 'Asia/Bangkok', viewport: { width: 1240, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.clock.setFixedTime(new Date('2026-10-30T10:30:00+07:00'));
  await p.addInitScript({ path: path.join(__dirname, 'mock-runtime.js') });
  await p.goto('file://' + path.join(__dirname, '..', 'dist', 'index.html'));
  const shot = (n, o = {}) => p.screenshot({ path: path.join(OUT, n + '.png'), ...o });

  /* ---- first-run setup ---- */
  await p.waitForSelector('#setupForm');
  await p.fill('[name=opw]', 'chu123'); await p.fill('[name=opw2]', 'chu123');
  for (const [i, pw] of ['staff-one', 'staff-two', 'staff-three'].entries()) await p.fill(`[name=pw${i}]`, pw);
  await shot('00_setup');
  await p.click('#setupForm [type=submit]');
  await p.waitForSelector('.whogrid');

  /* the artifact frame puts body{background:#fff} before the app's CSS; if it wins, it covers the colour field and dark mode turns pale */
  assert.strictEqual(await p.evaluate(() => {
    const s = document.createElement('style'); s.textContent = 'body{background:#fff}'; document.head.prepend(s);
    const bg = getComputedStyle(document.body).backgroundColor; s.remove(); return bg;
  }), 'rgba(0, 0, 0, 0)');

  /* default commission tiers must be 1% / 2% / 3% */
  const cfg = await p.evaluate(() => window.__store['cfg/main']);
  assert.deepStrictEqual([cfg.comm.r1, cfg.comm.r2, cfg.comm.r3], [0.01, 0.02, 0.03]);

  /* ---- wrong password rejected, right one accepted ---- */
  await p.click('[data-id=nv1]');
  await p.fill('#pw', 'sai'); await p.click('#loginForm [type=submit]');
  await p.waitForTimeout(800);
  assert((await p.textContent('#toast')).includes('Sai mật khẩu'));
  await p.fill('#pw', 'staff-one'); await p.click('#loginForm [type=submit]');
  await p.waitForSelector('.today-card');

  /* ---- An (monthly): today = work + lunch-out; day 5 = half + lunch via calendar modal ---- */
  await p.click('[data-act=setSt][data-v=work]'); await p.waitForTimeout(400);
  await p.check('.today-card [data-chg=lunch]'); await p.waitForTimeout(400);
  await p.click('[data-act=dayCell][data-d="05"]'); await p.waitForSelector('#mdayForm');
  await p.click('#mdayForm label:has-text("Nửa buổi")');
  await p.check('#mdayForm [name=lunch]');
  await p.fill('#mdayForm [name=note]', 'Đi khám');
  await p.click('#mdayForm [type=submit]'); await p.waitForTimeout(400);
  await p.evaluate(async () => {
    await mutateDays('nv1', days => { for (const d of [1, 2, 3, 6, 7, 8, 9, 10]) days[pad(d)] = { st: 'work', lunch: d % 2 === 0 }; });
  });
  const staffOne = await p.evaluate(() => { const R = calcPay('nv1'); return { cong: R.cong, lunchDays: R.lunchDays, base: R.base, comm: R.comm, net: R.net }; });
  assert.deepStrictEqual(staffOne, { cong: 9.5, lunchDays: 5, base: 3800000, comm: 2400000, net: 6350000 });
  await shot('01_monthly_calendar', { fullPage: true });

  /* isolation: An's session only holds her own data key */
  assert.deepStrictEqual(await p.evaluate(() => Object.keys(S.dk)), ['nv1']);
  await p.click('[data-act=logout]');

  /* ---- Chi (hourly + live): forgot-to-start dialog, auto-closed shifts ---- */
  await p.click('[data-id=nv3]'); await p.fill('#pw', 'staff-three'); await p.click('#loginForm [type=submit]');
  await p.waitForSelector('.today-card');
  await p.click('[data-act=punch][data-t=main]');          // 10:30 > 09:00 + 15' grace -> asks
  await p.waitForSelector('.choice');
  await shot('02_forgot_start');
  await p.click('[data-act=punchPick]>>nth=0');            // "I forgot — I've worked since 09:00"
  await p.waitForTimeout(400);
  const today = await p.evaluate(() => S.cache.nv3.days['30'].seg[0]);
  assert.strictEqual(today.in, '09:00'); assert.strictEqual(today.src, 'auto');
  await p.evaluate(async () => {
    await mutateDays('nv3', days => {
      days['01'] = { seg: [{ t: 'main', in: '09:00', out: '16:00' }, { t: 'liveD', in: '12:00', out: '14:00' }] };
      days['02'] = { seg: [{ t: 'main', in: '09:05', out: '' }] };                        // forgot END -> auto 16:00
      days['03'] = { seg: [{ t: 'main', in: '09:30', out: '12:30' }] };
      days['05'] = { seg: [{ t: 'main', in: '09:00', out: '16:00' }, { t: 'liveN', in: '19:00', out: '' }] }; // live END -> 21:00
    });
  });
  const staffThree = await p.evaluate(() => { const R = calcPay('nv3'); return { hours: +R.hours.toFixed(3), base: R.base, liveD: R.liveD, liveN: R.liveN, net: R.net, warn: R.warn }; });
  assert.deepStrictEqual(staffThree, { hours: 23.917, base: 1195833, liveD: 100000, liveN: 300000, net: 5795833, warn: ['3 ca tự điền giờ'] });
  await shot('03_hourly_calendar', { fullPage: true });

  await p.click('[data-act=tab][data-v=tk]');
  await p.selectOption('#bankForm [name=bin]', '970436');
  await p.fill('#bankForm [name=acct]', '1234567890');
  await p.fill('#bankForm [name=holder]', 'Nguyen Van A');
  await p.click('#bankForm [type=submit]'); await p.waitForTimeout(400);
  await p.click('[data-act=logout]');

  /* ---- Owner: report, slip + VietQR, PNG export ---- */
  await p.click('[data-id=owner]'); await p.fill('#pw', 'chu123'); await p.click('#loginForm [type=submit]');
  await p.waitForSelector('#revForm');
  await shot('04_owner_report', { fullPage: true });
  assert.deepStrictEqual(await p.evaluate(() => Object.keys(S.dk).sort()), ['nv1', 'nv2', 'nv3']);
  await p.click('[data-act=slip][data-id=nv3]'); await p.waitForSelector('.slip canvas'); await p.waitForTimeout(300);
  await shot('05_slip');
  await p.click('[data-act=exportSlip]'); await p.waitForSelector('.slip-prev');
  await shot('05b_slip_preview');
  await p.click('[data-act=saveSlip][data-fmt=png]'); await p.waitForTimeout(400);
  await p.click('[data-act=saveSlip][data-fmt=pdf]'); await p.waitForTimeout(400);
  assert.deepStrictEqual(await p.evaluate(() => window.__saved), ['the-luong-Chi-2026-10.png', 'the-luong-Chi-2026-10.pdf']);
  assert(await p.evaluate(async () => (await S._slipOut.pdf.slice(0, 8).text()) === '%PDF-1.4'));

  /* ---- VietQR / CRC16-CCITT-FALSE ---- */
  assert.strictEqual(await p.evaluate(() => crc16('123456789')), '29B1');            // standard check value
  const qr = await p.evaluate(() => vietqr('970436', '1234567890', 12345, 'LUONG T10 2026 CHI'));
  assert(qr.startsWith('000201010212') && qr.includes('5405' + '12345') && qr.includes('5303704'));
  assert.strictEqual(await p.evaluate(q => crc16(q.slice(0, -4)), qr), qr.slice(-4)); // embedded CRC is valid

  /* ---- commission engine ---- */
  const cm = await p.evaluate(() => { const c = commission(400e6, S.cfg.comm); return { fund: c.fund, paid: c.paid, capped: c.capped }; });
  assert.deepStrictEqual(cm, { fund: 8000000, paid: 8000000, capped: false });         // 100M*1% + 200M*2% + 100M*3%

  /* ---- a dated raise leaves earlier months alone, survives a later save, and can be removed ---- */
  await p.evaluate(() => { S.modal = null; renderModal(); });
  await p.click('[data-act=tab][data-v=cd]');
  const staffTwo = p.locator('.staffForm[data-id=nv2]');
  await staffTwo.locator('[name=monthly]').fill('6000000');
  await staffTwo.locator('[name=raiseAmt]').fill('7200000');
  await staffTwo.locator('[name=raiseFrom]').fill('2026-11');
  await staffTwo.locator('[type=submit]').click(); await p.waitForTimeout(400);
  const raises = () => p.evaluate(() => S.cache.nv2.sal.raises);
  assert.deepStrictEqual(await raises(), [{ from: '2026-11', monthly: 7200000 }]);
  assert.deepStrictEqual(await p.evaluate(() => [Math.round(calcPay('nv2', '2026-10').unit), calcPay('nv2', '2026-11').unit]), [250000, 300000]);
  await staffTwo.locator('[type=submit]').click(); await p.waitForTimeout(400);
  assert.deepStrictEqual(await raises(), [{ from: '2026-11', monthly: 7200000 }]);
  await staffTwo.locator('[name=raiseAmt]').fill('8400000');
  await staffTwo.locator('[type=submit]').click(); await p.waitForTimeout(400);
  assert((await p.textContent('#toast')).includes('Nhập đủ lương mới và tháng áp dụng'));
  await shot('06_settings_raise');
  await p.click('[data-act=rmRaise][data-id=nv2]'); await p.waitForTimeout(400);
  assert.deepStrictEqual(await raises(), []);

  /* ---- a bonus row is deleted on the second click, and the button stays on screen in a narrow window ---- */
  await p.click('[data-act=tab][data-v=thuong]');
  await p.fill('#bonForm [name=amt]', '500000');
  await p.fill('#bonForm [name=reason]', 'Đạt KPI');
  await p.click('#bonForm [type=submit]'); await p.waitForTimeout(400);
  const bons = () => p.evaluate(() => S.cache.nv1.bon.length);
  assert.strictEqual(await bons(), 1);
  await p.setViewportSize({ width: 375, height: 800 });
  const rmBon = p.locator('[data-act=rmBon]');
  const box = await rmBon.boundingBox();
  assert(box.x + box.width <= 375);
  await shot('06b_bonus_narrow');
  await rmBon.click();
  assert.strictEqual(await rmBon.textContent(), 'Xóa thật?');
  assert.strictEqual(await bons(), 1);
  await rmBon.click(); await p.waitForTimeout(400);
  assert.strictEqual(await bons(), 0);
  await p.setViewportSize({ width: 1240, height: 900 });

  /* ---- a marked Saturday counts 1 công on its own: the owner has no full-day option left ---- */
  await p.click('[data-act=tab][data-v=cc]');
  await p.click('[data-act=dayCell][data-d="10"]'); await p.waitForSelector('#mdayForm');
  assert.strictEqual(await p.locator('#mdayForm [name=fullDay]').count(), 0);
  await p.click('#mdayForm [type=submit]'); await p.waitForTimeout(400);
  assert.strictEqual(await p.evaluate(() => calcPay('nv1').cong), 9.5);

  /* ---- remembered login: survives a reload and an own password change, stops at logout or a password change elsewhere ---- */
  const reload = async () => {   // the mock db lives in memory, so carry it over the reload
    await p.addInitScript(s => Object.assign(window.__store, JSON.parse(s)), await p.evaluate(() => JSON.stringify(window.__store)));
    await p.reload(); await p.waitForSelector('.whogrid, .top');
  };
  const saved = () => p.evaluate(async () => { const s = await readLogin(); return s ? { who: s.who, extractable: s.key.extractable } : null; });
  assert.deepStrictEqual(await saved(), { who: 'owner', extractable: false });
  await reload();
  assert.strictEqual(await p.evaluate(() => S.role), 'owner');
  assert.deepStrictEqual(await p.evaluate(() => Object.keys(S.dk).sort()), ['nv1', 'nv2', 'nv3']);
  await p.click('[data-act=tab][data-v=cd]');
  await p.fill('#opwForm [name=p1]', 'chu456'); await p.fill('#opwForm [name=p2]', 'chu456');
  await p.click('#opwForm [type=submit]'); await p.waitForTimeout(800);
  await reload();
  assert.strictEqual(await p.evaluate(() => S.role), 'owner');
  await p.click('[data-act=logout]'); await p.waitForTimeout(200);
  assert.strictEqual(await saved(), null);
  await reload();
  assert.strictEqual(await p.evaluate(() => S.role), null);

  await p.click('[data-id=nv1]'); await p.fill('#pw', 'staff-one'); await p.click('#loginForm [type=submit]');
  await p.waitForSelector('.today-card');
  await p.evaluate(async () => { S.keep = false; await rewrapStaff('nv1', 'staff-one-2'); });   // as if the owner reset it from another machine
  await reload();
  assert.strictEqual(await p.evaluate(() => S.role), null);
  await p.waitForTimeout(200);
  assert.strictEqual(await saved(), null);

  await p.click('[data-id=nv1]'); await p.uncheck('#keepLogin'); await p.fill('#pw', 'staff-one-2'); await p.click('#loginForm [type=submit]');
  await p.waitForSelector('.today-card'); await p.waitForTimeout(200);
  assert.strictEqual(await saved(), null);
  await reload();
  assert.strictEqual(await p.evaluate(() => S.role), null);

  assert.deepStrictEqual(errs.filter(e => !e.includes('Sai mật khẩu')), []);
  console.log('E2E OK — screenshots in tests/out/');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

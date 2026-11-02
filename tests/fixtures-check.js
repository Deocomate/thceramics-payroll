/* Chạy calcPay() của app trên db/demo-fixtures.json và so với khối "_expected_2026-10". */
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
(async () => {
  const fx = JSON.parse(fs.readFileSync(path.join(root, 'db/demo-fixtures.json'), 'utf8'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ timezoneId: 'Asia/Bangkok' });
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date('2026-10-30T10:30:00+07:00'));
  await p.addInitScript({ path: path.join(__dirname, 'mock-runtime.js') });
  await p.goto('file://' + path.join(root, 'dist/index.html'));
  await p.waitForSelector('#setupForm');
  const got = await p.evaluate(fx => {
    S.ym = '2026-10';
    const pub = fx['cfg/main'];
    S.cfg = { staff: pub.staff.map(s => ({ id: s.id, name: s.name, title: s.title })), rates: pub.rates, comm: pub.comm, company: pub.company };
    S.mdoc = { ...fx['months/2026-10'], locked: {}, paid: {} };
    const dflt = { kind: 'month', monthly: 9600000, hourly: 0, page: 0, share: 0.3, lunch: true, live: false };
    const mk = id => ({ sal: fx['sal/' + id] || dflt, sp: fx['sp/' + id] || {}, days: (fx['sd/' + id + '_2026-10'] || { days: {} }).days, bon: (fx['bon/' + id + '_2026-10'] || { items: [] }).items });
    S.cache = { nv1: mk('nv1'), nv2: mk('nv2'), nv3: mk('nv3') };
    const o = {};
    for (const id of ['nv1', 'nv2', 'nv3']) { const R = calcPay(id); o[id] = { cong: R.cong, hours: R.hours && +R.hours.toFixed(3), base: R.base, lunch: R.lunch, liveD: R.liveD, liveN: R.liveN, page: R.page, comm: R.comm, bonus: R.bonus, deduct: R.deduct, net: R.net, warn: R.warn }; }
    o.pgH = calcPay('nv3').pgH;
    S.cache.nv3.days['10'] = { seg: [{ t: 'main', in: '09:30', out: '16:00' }] };   // T7 làm cả ngày: trực 16:00–23:00
    o.pgHFullSat = calcPay('nv3').pgH;
    S.cache.nv3.sal = { ...S.cache.nv3.sal, sched: { ...S.cache.nv3.sal.sched, pgWd: ['16:00', '10:00'], pgSat: ['13:00', '09:00'], pgSun: ['09:00', '10:00'] } };   // khung cũ qua đêm đã lưu trong DB
    o.pgHOldSched = calcPay('nv3').pgH;
    S.cache.nv2.sal = { ...S.cache.nv2.sal, monthly: 6000000, raises: [{ from: '2026-11', monthly: 7200000 }, { from: '2027-03', monthly: 9600000 }] };   // thử việc rồi tăng lương
    o.units = ['2026-10', '2026-11', '2027-02', '2027-03'].map(ym => Math.round(calcPay('nv2', ym).unit));
    S.cache.nv2.days = { '10': { st: 'work' }, '17': { st: 'half', fullDay: true }, '18': { st: 'work' }, '19': { st: 'work' } };   // T7, T7 nửa buổi (fullDay cũ không còn tác dụng), CN, T2
    o.weekendCong = calcPay('nv2').cong;
    return o;
  }, fx);
  assert.strictEqual(got.pgH, 262.5);
  assert.strictEqual(got.pgHFullSat, 259);
  assert.strictEqual(got.pgHOldSched, 259);
  assert.deepStrictEqual(got.units, [250000, 300000, 300000, 400000]);
  assert.strictEqual(got.weekendCong, 3.5);   // 1 + 0,5 + 1 + 1
  const exp = fx['_expected_2026-10'];
  for (const id of Object.keys(exp)) {
    if (id === '_note') continue;
    for (const [k, v] of Object.entries(exp[id])) assert.deepStrictEqual(got[id][k], v, `${id}.${k}`);
  }
  console.log('Fixtures OK');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

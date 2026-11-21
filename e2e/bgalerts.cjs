// آزمون پل هشدار قیمت پس‌زمینه.  اجرا: node e2e/bgalerts.cjs
const { openApp, reporter } = require('./helpers.cjs');
const t = reporter('bgalerts');
const store = JSON.stringify({ v: 1, sample: false,
  assets: [{ id: 'gold', name: 'طلا', unit: 'گرم', kind: 'metal', decimals: 3 }, { id: 'sh', name: 'فملی', unit: 'سهم', kind: 'stock', decimals: 0, priceKeys: { tsetmc: '123456789' } }, { id: 'house', name: 'ملک', unit: 'عدد', kind: 'other', decimals: 0 }],
  txs: [{ id: 't1', seq: 1, assetId: 'cash', type: 'deposit', date: '2026-01-02', quantity: '1000', unitPrice: '1', fee: '0' }],
  prices: {}, people: [], debts: [], payments: [], cheques: [], history: [],
  reminders: [
    { id: 'r1', kind: 'price', assetId: 'gold', side: 'sell', cond: 'above', target: '70000000' },
    { id: 'r2', kind: 'price', assetId: 'sh', side: 'buy', cond: 'below', target: '9000' },
    { id: 'r3', kind: 'price', assetId: 'house', side: 'sell', cond: 'above', target: '5' },
    { id: 'r4', kind: 'price', assetId: 'gold', side: 'buy', cond: 'below', target: '1', firedAt: '2026-11-01T00:00:00Z' }],
  settings: { unit: 'toman', theme: 'light', font: 'normal', onboarded: true } });
(async () => {
  const app = await openApp({ local: store });
  await app.page.waitForTimeout(1500);
  const msgs = await app.sent('bg-alerts');
  const bg = msgs[msgs.length - 1]?.bg;
  t.ok(!!bg, 'فهرست هشدارها به بخش بومی فرستاده می‌شود');
  const ids = (bg?.alerts ?? []).map((a) => a.id).sort();
  t.ok(JSON.stringify(ids) === JSON.stringify(['r1', 'r2']), 'فقط هشدار فعال و دارای قیمت خودکار می‌رود (نه فعال‌شده، نه دارایی بی‌منبع): ' + ids);
  const g = bg.alerts.find((a) => a.id === 'r1');
  t.ok(g.provider === 'tgju' && g.key === 'geram18' && g.target === '70000000', 'طلا از TGJU با کلید درست');
  t.ok(bg.alerts.find((a) => a.id === 'r2').provider === 'tsetmc', 'سهم از بورس');
  t.ok(!JSON.stringify(bg).includes('1000'), 'هیچ مقدار دارایی یا سرمایه‌ای فرستاده نمی‌شود');
  // برگشت هشدار فعال‌شده از پس‌زمینه: علامت می‌خورد، اعلان دوباره نمی‌آید
  const before = (await app.sent('notify-now')).length;
  await app.page.evaluate(() => window.__bgFired(['r1', 'zzz']));
  const st = await app.store();
  t.ok(st.reminders.find((r) => r.id === 'r1').firedAt && st.reminders.find((r) => r.id === 'r1').seen === false, 'هشدار فعال‌شده در پس‌زمینه علامت‌گذاری شد');
  t.ok((await app.sent('notify-now')).length === before, 'اعلان تکراری فرستاده نشد');
  await app.page.waitForTimeout(1500);
  const again = (await app.sent('bg-alerts')).pop().bg.alerts.map((a) => a.id);
  t.ok(!again.includes('r1'), 'هشدار فعال‌شده از فهرست پس‌زمینه برداشته شد');
  t.ok(app.errors.length === 0, 'بدون خطا: ' + app.errors.join('|'));
  await app.close();
  process.exit(t.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

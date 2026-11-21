// آزمون نمودار روند (بازه‌ی روز و انتخاب نقطه) و درصد سود و زیان دارایی‌ها.  اجرا: node e2e/home.cjs
const { openApp, reporter } = require('./helpers.cjs');
const t = reporter('home');
const now = Date.now();
const history = Array.from({ length: 12 }, (_, i) => ({ at: new Date(now - (11 - i) * 3600e3).toISOString(), value: String(100000000 + i * 1000000 + (i % 3) * 500000) }));
const store = JSON.stringify({ v: 1, sample: false,
  assets: [{ id: 'gold', name: 'طلا', unit: 'گرم', kind: 'metal', decimals: 3 }],
  txs: [{ id: 't1', seq: 1, assetId: 'gold', type: 'buy', date: '2026-01-02', quantity: '2', unitPrice: '50000000', fee: '0' }],
  prices: { gold: { assetId: 'gold', price: '60000000', source: 'manual', at: new Date().toISOString() } },
  people: [], debts: [], payments: [], reminders: [], cheques: [], history,
  settings: { unit: 'toman', theme: 'light', font: 'normal', onboarded: true } });
(async () => {
  const app = await openApp({ local: store });
  t.ok(await app.page.locator('button[data-action="history-range"][data-v="1d"]').count() === 1, 'گزینه‌ی «۱ روز» هست');
  await app.act('history-range', '1d');
  const box = await app.page.locator('.spark-svg').boundingBox();
  t.ok(!!box, 'نمودار در بازه‌ی روز نمایش داده می‌شود');
  await app.page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  let txt = await app.page.textContent('#sp-read');
  t.ok(txt.includes('تغییر نسبت به نقطه‌ی قبل') && txt.includes('سرمایه'), 'انتخاب نقطه: مقدار و تغییر نمایش داده می‌شود');
  await app.page.mouse.click(box.x + 2, box.y + box.height / 2);
  txt = await app.page.textContent('#sp-read');
  t.ok(txt.includes('ابتدای بازه'), 'نقطه‌ی اول: ابتدای بازه');
  await app.tab('assets');
  const body = await app.page.textContent('body');
  t.ok(body.includes('+۲۰٫۰٪'), 'تب دارایی‌ها: درصد سود (۲۰٪) نمایش داده می‌شود');
  t.ok(body.includes('نسبت به بهای خرید موجودی'), 'تب دارایی‌ها: خلاصه‌ی سود و زیان کل');
  t.ok(app.errors.length === 0, 'بدون خطا: ' + app.errors.join('|'));
  await app.close();
  process.exit(t.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

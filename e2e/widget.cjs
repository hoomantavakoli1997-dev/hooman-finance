// آزمون ارسال داده‌ی ویجت: سرمایه فقط با رضایت، و قیمت نمونه هرگز.  اجرا: node e2e/widget.cjs
const { openApp, reporter } = require('./helpers.cjs');
const t = reporter('widget');
const store = (extra = {}) => JSON.stringify({ v: 1, sample: false,
  assets: [{ id: 'gold', name: 'طلا', unit: 'گرم', kind: 'metal', decimals: 3 }],
  txs: [{ id: 't1', seq: 1, assetId: 'cash', type: 'deposit', date: '2026-01-02', quantity: '1000000000', unitPrice: '1', fee: '0' }],
  prices: {}, people: [], debts: [], payments: [], reminders: [], cheques: [], history: [],
  settings: { unit: 'toman', theme: 'light', font: 'normal', onboarded: true, favs: ['geram18', 'price_dollar_rl'], ...extra } });
const last = async (app) => { await app.page.waitForTimeout(1200); const m = await app.sent('widget-config'); return m[m.length - 1]?.widget; };
(async () => {
  let app = await openApp({ local: store() });
  let w = await last(app);
  t.ok(!!w, 'پیکربندی ویجت به بخش بومی فرستاده می‌شود');
  t.ok(w.showWorth === false && w.worth === null, 'پیش‌فرض: سرمایه‌ی خالص فرستاده نمی‌شود');
  t.ok(Array.isArray(w.rows) && w.rows.length === 0 && w.updatedAt === null, 'قیمت نمونه‌ی همراه برنامه به‌عنوان قیمت زنده نمی‌آید');
  t.ok(JSON.stringify(w.keys) === JSON.stringify(['geram18', 'price_dollar_rl']), 'کلیدهای منتخب نمای بازار فرستاده می‌شود');
  await app.tab('settings');
  t.ok((await app.page.textContent('body')).includes('ویجت صفحه‌ی اصلی'), 'بخش ویجت در تنظیمات هست');
  await app.act('widget-worth');
  w = await last(app);
  t.ok(w.showWorth === true && /۱۰۰٬۰۰۰٬۰۰۰/.test(w.worth), 'با روشن کردن: سرمایه‌ی خالص فرستاده می‌شود: ' + w.worth);
  await app.act('toggle-hide');
  w = await last(app);
  t.ok(w.worth === null, 'با «پنهان کردن مبلغ‌ها» سرمایه از ویجت برداشته می‌شود');
  t.ok(app.errors.length === 0, 'بدون خطا: ' + app.errors.join('|'));
  await app.close();
  process.exit(t.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

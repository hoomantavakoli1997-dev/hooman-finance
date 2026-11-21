// آزمون رابط ثبت سود دریافتی.  اجرا: node e2e/income.cjs
const { openApp, reporter } = require('./helpers.cjs');
const t = reporter('income');
const store = JSON.stringify({
  v: 1, sample: false,
  assets: [{ id: 'gold', name: 'طلا ۱۸ عیار', unit: 'گرم', kind: 'metal', decimals: 3 }],
  txs: [{ id: 't1', seq: 1, assetId: 'cash', type: 'deposit', date: '2026-01-01', quantity: '10000000', unitPrice: '1', fee: '0' }],
  prices: {}, people: [], debts: [], payments: [], cheques: [], reminders: [], history: [], settings: { unit: 'rial', theme: 'light', font: 'normal' },
});
(async () => {
  const app = await openApp({ local: store });
  await app.act('income-new');
  await app.page.fill('#in-src', 'فولاد');
  await app.page.fill('#in-am', '500000');
  await app.act('income-save');
  let s = await app.store();
  const inc = s.txs.find((x) => x.income);
  t.ok(inc && inc.income === 'dividend' && inc.quantity === '500000' && inc.assetId === 'cash' && inc.type === 'deposit', 'سود سهام به‌صورت واریز نقد برچسب‌دار ثبت شد');
  t.ok((await app.page.textContent('body')).includes('سود دریافتی در ۳۶۵ روز اخیر'), 'کارت سود دریافتی در خانه');

  // روزشمار: ۱۰۰ میلیون، ۲۳٪، ۳۰ روز
  await app.act('income-new');
  await app.act('income-kind', 'accrual');
  await app.page.fill('#in-pr', '100000000');
  await app.page.fill('#in-rt', '23');
  // تاریخ‌ها را از روی امروز و ۳۰ روز قبل می‌گذاریم (فیلدها همان مقدار پیش‌فرض‌اند)
  await app.act('income-calc');
  const amt = (await app.page.inputValue('#in-am')).replace(/[٬,\s]/g, '').replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x6f0);
  t.ok(amt === '1890411', 'محاسبه‌ی روزشمار ۳۰ روزه: ' + amt);
  await app.act('income-save');
  s = await app.store();
  t.ok(s.txs.filter((x) => x.income).length === 2, 'دو درآمد ثبت شده است');

  await app.act('income-new');
  await app.page.fill('#in-am', '0');
  await app.act('income-save');
  t.ok((await app.page.locator('#ferr').textContent()) !== '', 'مبلغ صفر رد می‌شود');
  t.ok(app.errors.length === 0, 'بدون خطای جاوااسکریپت: ' + app.errors.join('|'));
  await app.close();
  process.exit(t.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// آزمون رابط ماشین‌حساب وام.  اجرا: node e2e/loan.cjs
const { openApp, reporter } = require('./helpers.cjs');
const t = reporter('loan');
const store = JSON.stringify({
  v: 1, sample: false, assets: [], txs: [], prices: {}, people: [], debts: [], payments: [], cheques: [], reminders: [], history: [],
  settings: { unit: 'rial', theme: 'light', font: 'normal' },
});
(async () => {
  const app = await openApp({ local: store });
  await app.act('loan-open');
  await app.page.fill('#ln-p', '100000000');
  await app.page.fill('#ln-r', '18');
  await app.page.fill('#ln-m', '12');
  await app.act('loan-calc');
  const body = await app.page.textContent('body');
  t.ok(body.includes('۹٬۱۶۷٬۹۹۹'), 'قسط ماهانه کاهشی ۹٬۱۶۷٬۹۹۹');
  t.ok(await app.page.locator('.loantbl tbody tr').count() === 12, 'جدول ۱۲ قسط');
  await app.act('loan-method', 'flat');
  await app.act('loan-calc');
  t.ok((await app.page.textContent('body')).includes('۹٬۸۳۳٬۳۳۳'), 'قسط ثابت ۹٬۸۳۳٬۳۳۳');
  await app.page.fill('#ln-k', '9167999');
  await app.act('loan-rate');
  t.ok((await app.page.textContent('body')).includes('۱۸٫۰۰٪'), 'نرخ مؤثر ۱۸٪');
  await app.page.fill('#ln-m', '0');
  await app.act('loan-calc');
  t.ok((await app.page.locator('#ferr').textContent()) !== '', 'تعداد قسط نامعتبر رد می‌شود');
  await app.page.fill('#ln-m', '12');
  await app.act('loan-calc');
  await app.act('loan-save');
  t.ok((await app.page.textContent('body')).includes('وام'), 'فرم ثبت وام باز شد');
  await app.page.fill('[data-field="name"]', 'بلو بانک');
  await app.act('debt-save');
  const s = await app.store();
  t.ok(s.debts.length === 1 && s.debts[0].plan && s.debts[0].plan.count === 12 && s.debts[0].direction === 'borrowed', 'وام با طرح ۱۲ قسطی ثبت شد');
  t.ok(app.errors.length === 0, 'بدون خطای جاوااسکریپت: ' + app.errors.join('|'));
  await app.close();
  process.exit(t.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

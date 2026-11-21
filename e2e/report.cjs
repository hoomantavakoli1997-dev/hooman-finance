// آزمون رابط گزارش ماهانه و خروجی CSV.  اجرا: node e2e/report.cjs
const { openApp, reporter } = require('./helpers.cjs');
const t = reporter('report');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
const store = JSON.stringify({
  v: 1, sample: false,
  assets: [{ id: 'gold', name: 'طلا ۱۸ عیار', unit: 'گرم', kind: 'metal', decimals: 3 }],
  txs: [
    { id: 't1', seq: 1, assetId: 'cash', type: 'deposit', date: today, quantity: '5000', unitPrice: '1', fee: '0' },
    { id: 't2', seq: 2, assetId: 'gold', type: 'buy', date: today, quantity: '2', unitPrice: '1000', fee: '10', note: '=1+1' },
    { id: 't3', seq: 3, assetId: 'cash', type: 'deposit', date: today, quantity: '70', unitPrice: '1', fee: '0', income: 'dividend', source: 'فولاد' },
  ],
  prices: {}, people: [], debts: [], payments: [], cheques: [], reminders: [], history: [], settings: { unit: 'rial', theme: 'light', font: 'normal' },
});
(async () => {
  const app = await openApp({ local: store });
  await app.act('report-open');
  const body = await app.page.textContent('body');
  t.ok(body.includes('گزارش ماهانه') && body.includes('مجموع خرید'), 'صفحه‌ی گزارش باز می‌شود');
  t.ok(body.includes('۲٬۰۱۰'), 'مجموع خرید ۲٬۰۱۰ ریال');
  await app.act('report-csv', 'month');
  const sent = await app.sent('share-file');
  t.ok(sent.length === 1 && sent[0].mime === 'text/csv', 'فایل CSV به بخش اشتراک‌گذاری رفت');
  t.ok(sent[0].text.charCodeAt(0) === 0xfeff, 'BOM برای فارسی در Excel');
  t.ok(sent[0].text.includes("'=1+1"), 'یادداشت فرمول‌نما بی‌اثر شد');
  t.ok(sent[0].text.includes('سود سهام') && sent[0].text.split('\r\n').filter(Boolean).length === 4, 'سه تراکنش + سرستون');
  await app.act('report-nav', '-1');
  const b2 = await app.page.textContent('body');
  t.ok(b2.includes('تعداد معاملات') && !b2.includes('۲٬۰۱۰'), 'ماه قبل خالی است');
  await app.act('report-csv', 'summary');
  t.ok((await app.sent('share-file')).length === 2, 'خلاصه هم ساخته شد');
  t.ok(app.errors.length === 0, 'بدون خطای جاوااسکریپت: ' + app.errors.join('|'));
  await app.close();
  process.exit(t.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// آزمون رابط سود واقعی.  اجرا: node e2e/realreturn.cjs
const { KEY, openApp, reporter } = require('./helpers.cjs');
const t = reporter('realreturn');

const now = new Date().toISOString();
const y = new Date(Date.now() - 200 * 864e5).toISOString().slice(0, 10);
const store = JSON.stringify({
  v: 1, sample: false,
  assets: [{ id: 'gold', name: 'طلا ۱۸ عیار', unit: 'گرم', kind: 'metal', decimals: 3 }, { id: 'usd', name: 'دلار', unit: 'دلار', kind: 'currency', decimals: 2 }],
  txs: [{ id: 't1', seq: 1, assetId: 'gold', type: 'buy', date: y, quantity: '1', unitPrice: '1000', fee: '0' }],
  prices: { gold: { assetId: 'gold', price: '1200', source: 'auto', at: now }, usd: { assetId: 'usd', price: '110', source: 'auto', at: now } },
  priceLog: { [y]: { usd: '100' } },
  people: [], debts: [], payments: [], cheques: [], reminders: [], history: [], settings: { unit: 'rial', theme: 'light', font: 'normal' },
});

(async () => {
  const app = await openApp({ local: store });
  await app.tab('assets');
  const body = async () => app.page.textContent('body');
  let b = await body();
  t.ok(b.includes('سود واقعی دارایی‌ها'), 'کارت سود واقعی نمایش داده می‌شود');
  t.ok(b.includes('+۲۰٫۰٪'), 'سود اسمی ۲۰٪');
  t.ok(b.includes('+۹٫۱٪'), 'نسبت به دلار ۹٫۱٪');
  t.ok(b.includes('نرخ تورم وارد نشده'), 'بدون نرخ تورم: ساختگی نشان داده نمی‌شود');
  await app.act('infl-open');
  await app.page.fill('#i-v', '40');
  await app.act('infl-save');
  b = await body();
  t.ok(b.includes('نرخ تورم: ۴۰٪'), 'نرخ تورم ذخیره شد');
  t.ok((await app.store()).settings.inflation === 40, 'نرخ تورم در داده ذخیره شد');
  await app.act('infl-open');
  await app.page.fill('#i-v', 'abc');
  await app.act('infl-save');
  t.ok(await app.page.locator('#ferr').textContent() !== '', 'مقدار نامعتبر رد می‌شود');
  t.ok(app.errors.length === 0, 'بدون خطای جاوااسکریپت: ' + app.errors.join('|'));
  await app.close();
  process.exit(t.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

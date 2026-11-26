// آزمون نمودار قیمت هر دارایی و مقایسه با بانک و تورم.  اجرا: node e2e/assetinsight.cjs
const { openApp, reporter } = require('./helpers.cjs');
const t = reporter('assetinsight');

const day = (n) => new Date(Date.now() - n * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
const now = new Date().toISOString();
const log = {};
for (let i = 40; i >= 0; i -= 5) log[day(i)] = { gold: String(1000 + (40 - i) * 10), usd: '100' };
const mk = (withLog) => JSON.stringify({
  v: 1, sample: false,
  assets: [{ id: 'gold', name: 'طلا ۱۸ عیار', unit: 'گرم', kind: 'metal', decimals: 3 }, { id: 'usd', name: 'دلار', unit: 'دلار', kind: 'currency', decimals: 2 }],
  txs: [{ id: 't1', seq: 1, assetId: 'gold', type: 'buy', date: day(365), quantity: '10', unitPrice: '1000', fee: '0' }],
  prices: { gold: { assetId: 'gold', price: '1500', source: 'auto', at: now }, usd: { assetId: 'usd', price: '110', source: 'auto', at: now } },
  priceLog: withLog ? log : {},
  people: [], debts: [], payments: [], cheques: [], reminders: [], history: [], settings: { unit: 'rial', theme: 'light', font: 'normal', onboarded: true },
});

(async () => {
  let app = await openApp({ local: mk(true) });
  await app.tab('assets');
  await app.act('open-asset', 'gold');
  let b = await app.page.textContent('body');
  t.ok(b.includes('روند قیمت'), 'نمودار قیمت در صفحه‌ی دارایی هست');
  t.ok(await app.page.locator('.spark-svg').count() === 1, 'نمودار ترسیم شد');
  await app.page.locator('.spark-svg').scrollIntoViewIfNeeded();
  const box = await app.page.locator('.spark-svg').boundingBox();
  await app.page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  const read = await app.page.textContent('#sp-read');
  t.ok(read.includes('قیمت') && !read.includes('روی نمودار بزنید') && /[۰-۹]/.test(read), 'انتخاب نقطه: تاریخ و قیمت نمایش داده می‌شود: ' + read.slice(0, 80));
  await app.act('asset-range', '1m');
  t.ok(await app.page.locator('[data-action="asset-range"][aria-pressed="true"]').textContent() === '۱ ماه', 'تغییر بازه');
  t.ok(b.includes('مقایسه با بانک و تورم'), 'کارت مقایسه هست');
  t.ok(b.includes('سود بانکی وارد نشده') && b.includes('نرخ تورم وارد نشده'), 'بدون نرخ: ساختگی نشان داده نمی‌شود');

  await app.act('bank-open');
  await app.page.fill('#b-v', '20');
  await app.act('bank-save');
  b = await app.page.textContent('body');
  t.ok((await app.store()).settings.bankRate === 20, 'سود بانکی ذخیره شد');
  t.ok(b.includes('نسبت به بانک') && b.includes('+۲۵٫۰٪'), 'بانک: ۱۵۰۰۰ در برابر ۱۲۰۰۰ = ۲۵٪ بهتر');

  await app.act('infl-open', 'gold');
  await app.page.fill('#i-v', '40');
  await app.act('infl-save');
  const st = await app.store();
  t.ok(st.assets.find((a) => a.id === 'gold').inflation === 40, 'تورم مخصوص دارایی ذخیره شد');
  t.ok(st.settings.inflation === undefined, 'نرخ کلی دست‌نخورده ماند');
  b = await app.page.textContent('body');
  t.ok(b.includes('سود واقعی نسبت به تورم') && b.includes('+۷٫۱٪'), 'تورم: ۱۵۰ به ۱۴۰ = ۷٫۱٪');
  await app.act('infl-open', 'gold');
  await app.page.fill('#i-v', 'abc');
  await app.act('infl-save');
  t.ok(await app.page.locator('#ferr').textContent() !== '', 'مقدار نامعتبر رد می‌شود');
  await app.act('close');
  t.ok(app.errors.length === 0, 'بدون خطای جاوااسکریپت: ' + app.errors.join('|'));
  await app.close();

  app = await openApp({ local: mk(false) });
  await app.tab('assets');
  await app.act('open-asset', 'gold');
  b = await app.page.textContent('body');
  t.ok(b.includes('هنوز برای نمودار کافی نیست') && await app.page.locator('.spark-svg').count() === 0, 'بدون تاریخچه: نمودار ساختگی نیست');
  t.ok(app.errors.length === 0, 'بدون خطا (حالت بدون تاریخچه): ' + app.errors.join('|'));
  await app.close();
  process.exit(t.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

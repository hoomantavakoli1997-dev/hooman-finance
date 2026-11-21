// آزمون رابط نمودار ترکیب دارایی‌ها.  اجرا: node e2e/allocation.cjs
const { openApp, reporter } = require('./helpers.cjs');
const t = reporter('allocation');
const now = new Date().toISOString();
const store = JSON.stringify({
  v: 1, sample: false,
  assets: [{ id: 'gold', name: 'طلا ۱۸ عیار', unit: 'گرم', kind: 'metal', decimals: 3 }, { id: 'usd', name: 'دلار', unit: 'دلار', kind: 'currency', decimals: 2 }],
  txs: [
    { id: 't1', seq: 1, assetId: 'cash', type: 'deposit', date: '2026-01-01', quantity: '1000', unitPrice: '1', fee: '0' },
    { id: 't2', seq: 2, assetId: 'gold', type: 'buy', date: '2026-01-02', quantity: '1', unitPrice: '1000', fee: '0' },
    { id: 't3', seq: 3, assetId: 'usd', type: 'buy', date: '2026-01-02', quantity: '10', unitPrice: '100', fee: '0' },
  ],
  prices: { gold: { assetId: 'gold', price: '2000', source: 'manual', at: now } },
  people: [], debts: [], payments: [], cheques: [], reminders: [], history: [], settings: { unit: 'rial', theme: 'light', font: 'normal' },
});
(async () => {
  const app = await openApp({ local: store });
  await app.tab('assets');
  const html = await app.page.content();
  t.ok(html.includes('ترکیب دارایی‌ها'), 'کارت ترکیب نمایش داده می‌شود');
  t.ok(await app.page.locator('svg.donut circle').count() === 3, 'یک حلقه‌ی پس‌زمینه + دو برش (نقد و طلا)');
  const txt = await app.page.locator('.alloclist').textContent();
  t.ok(txt.includes('نقد') && txt.includes('طلا و فلزات') && !txt.includes('ارز'), 'دارایی بدون قیمت در نمودار نیست');
  t.ok(txt.includes('۳۳٫۳٪') && txt.includes('۶۶٫۷٪'), 'درصدها: ۳۳٫۳ و ۶۶٫۷');
  t.ok(html.includes('دارایی‌های بدون قیمت روز در این نمودار نیستند'), 'یادآوری دارایی بدون قیمت');
  await app.act('toggle-hide');
  t.ok(!(await app.page.locator('.alloclist .am').first().textContent()).match(/[۰-۹]/), 'در حالت پنهان، مبلغ دیده نمی‌شود');
  t.ok(app.errors.length === 0, 'بدون خطای جاوااسکریپت: ' + app.errors.join('|'));
  await app.close();
  process.exit(t.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

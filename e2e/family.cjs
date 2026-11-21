// آزمون گزارش خانواده.  اجرا: node e2e/family.cjs
const { openApp, reporter } = require('./helpers.cjs');
const t = reporter('family');
const store = JSON.stringify({ v: 1, sample: false, assets: [{ id: 'gold', name: 'طلا', unit: 'گرم', kind: 'metal', decimals: 3 }], txs: [
  { id: 't1', seq: 1, assetId: 'cash', type: 'deposit', date: '2026-01-01', quantity: '40000000', unitPrice: '1', fee: '0' },
  { id: 't2', seq: 2, assetId: 'gold', type: 'receive', date: '2026-01-02', quantity: '1', unitPrice: '60000000', fee: '0' }],
  prices: { gold: { assetId: 'gold', price: '60000000', source: 'manual', at: new Date().toISOString() } },
  people: [], debts: [], payments: [], history: [], reminders: [], settings: { unit: 'toman', theme: 'light', font: 'normal' },
  cheques: [{ id: 'c1', direction: 'received', number: '9999', bank: 'ملی', accountHolder: 'علی‌رازدار', amount: '5000000', issueDate: '2026-01-01', dueDate: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), status: 'pending', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }] });
(async () => {
  const app = await openApp({ local: store });
  await app.act('family-open');
  let txt = await app.page.textContent('#fam-prev');
  t.ok(txt.includes('طلا و فلزات') && txt.includes('نقد'), 'ترکیب دارایی در گزارش هست');
  t.ok(!txt.includes('علی‌رازدار') && !txt.includes('۹۹۹۹'), 'پیش‌فرض: بدون نام و شماره چک');
  t.ok(txt.includes('چکِ دریافتی'), 'تعهد پیش‌رو با برچسب عمومی');
  t.ok(!/[0-9۰-۹]{1,3}٬[0-9۰-۹]{3}/.test(txt), 'پیش‌فرض: بدون مبلغ');
  await app.page.check('input[data-field="amounts"]');
  txt = await app.page.textContent('#fam-prev');
  t.ok(/۱۰٬۵۰۰٬۰۰۰/.test(txt), 'با مبلغ: سرمایه‌ی خالص نمایش داده می‌شود');
  await app.page.check('input[data-field="names"]');
  txt = await app.page.textContent('#fam-prev');
  t.ok(txt.includes('علی‌رازدار') && !txt.includes('۹۹۹۹'), 'با نام: نام هست ولی شماره‌ی چک هرگز نیست');
  await app.act('family-share');
  const sent = await app.sent('share-file');
  t.ok(sent.length === 1 && sent[0].name.endsWith('.txt') && sent[0].text.includes('گزارش دارایی خانواده'), 'ارسال با منوی اشتراک');
  t.ok(app.errors.length === 0, 'بدون خطا: ' + app.errors.join('|'));
  await app.close();
  process.exit(t.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

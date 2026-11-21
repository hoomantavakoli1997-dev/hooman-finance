// آزمون پشتیبان کامل: چک‌ها، یادآورها، قیمت‌ها و تنظیمات باید با بازیابی برگردند.  اجرا: node e2e/backup.cjs
const { openApp, reporter } = require('./helpers.cjs');
const t = reporter('backup');
const future = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const full = {
  v: 1, sample: false,
  assets: [{ id: 'gold', name: 'طلا', unit: 'گرم', kind: 'metal', decimals: 3 }],
  txs: [{ id: 't1', seq: 1, assetId: 'gold', type: 'receive', date: '2026-01-02', quantity: '2', unitPrice: '60000000', fee: '0' }],
  prices: { gold: { assetId: 'gold', price: '61000000', source: 'manual', at: '2026-11-01T00:00:00Z' } },
  people: [{ id: 'p1', name: 'علی' }],
  debts: [{ id: 'd1', personId: 'p1', direction: 'lent', title: 'قرض', amount: '1000000', date: '2026-02-01' }],
  payments: [{ id: 'y1', debtId: 'd1', date: '2026-03-01', amount: '100000' }],
  history: [{ at: '2026-11-01T00:00:00.000Z', value: '120000000' }],
  reminders: [
    { id: 'r1', kind: 'date', title: 'یادآور آزمون', date: future(10), leadDays: 1 },
    { id: 'r2', kind: 'price', assetId: 'gold', side: 'sell', cond: 'above', target: '70000000' }],
  cheques: [{ id: 'c1', direction: 'issued', number: '123', bank: 'ملت', accountHolder: 'من', amount: '2000000', issueDate: '2026-01-01', dueDate: future(20), status: 'pending', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
  priceLog: { '2026-11-01': { gold: '61000000', usd: '1000000' } },
  settings: { unit: 'toman', theme: 'light', font: 'normal', inflation: 35, onboarded: true },
};
(async () => {
  let a = await openApp({ local: JSON.stringify(full) });
  await a.tab('settings');
  await a.act('backup-open');
  await a.page.fill('#bk-pass', 'رمز-آزمون-قوی');
  await a.page.fill('#bk-pass2', 'رمز-آزمون-قوی');
  await a.act('backup-make');
  await a.page.waitForTimeout(1500);
  const sent = await a.sent('share-file');
  t.ok(sent.length === 1, 'فایل پشتیبان ساخته شد');
  const file = sent[0]?.text ?? '';
  t.ok(!file.includes('یادآور آزمون') && !file.includes('cheques') && !file.includes('accountHolder'), 'فایل پشتیبان رمزشده است (متن ساده‌ای در آن نیست)');
  await a.close();

  const b = await openApp({ local: JSON.stringify({ ...full, assets: [], txs: [], reminders: [], cheques: [], debts: [], payments: [], people: [], priceLog: {}, prices: {}, settings: { unit: 'rial', theme: 'light', font: 'normal', onboarded: true } }) });
  await b.tab('settings');
  await b.page.setInputFiles('#restore-file', { name: 'b.hfbackup', mimeType: 'text/plain', buffer: Buffer.from(file) });
  await b.page.waitForSelector('#rs-pass');
  await b.page.fill('#rs-pass', 'رمز-آزمون-قوی');
  await b.act('restore-check');
  await b.page.waitForSelector('[data-action="restore-apply"]', { timeout: 15000 });
  await b.act('restore-apply');
  await b.page.waitForTimeout(500);
  const s = await b.store();
  t.ok(s.cheques?.length === 1 && s.cheques[0].number === '123' && s.cheques[0].status === 'pending', 'چک‌ها برگشتند');
  t.ok(s.reminders?.length === 2 && s.reminders.some((r) => r.kind === 'price' && r.target === '70000000'), 'یادآورهای تاریخ و قیمت برگشتند');
  t.ok(s.priceLog?.['2026-11-01']?.usd === '1000000', 'گزارش قیمت روزانه برگشت');
  t.ok(s.settings.inflation === 35, 'نرخ تورم برگشت');
  t.ok(s.debts.length === 1 && s.payments.length === 1 && s.people.length === 1, 'اشخاص، وام‌ها و پرداخت‌ها برگشتند');
  t.ok(s.history?.length >= 1, 'تاریخچه‌ی سرمایه برگشت');
  t.ok(!s.settings.lock, 'قفل برنامه در پشتیبان نیست (عمداً)');
  t.ok(b.errors.length === 0, 'بدون خطا: ' + b.errors.join('|'));
  await b.close();
  process.exit(t.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

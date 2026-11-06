import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from './decimal';
import {
  addTx, computeAssetState, computeCash, computePortfolio, deleteTx, restoreTx,
  TxDraft, updateTx, validateAll, validateFields,
} from './engine';
import { Asset, CASH_ID, PriceEntry, Tx } from './types';

const D = (v: string) => Decimal.parse(v);
const gold: Asset = { id: 'gold', name: 'طلا', unit: 'گرم', kind: 'metal', decimals: 3 };

const draft = (p: Partial<TxDraft> & Pick<TxDraft, 'type' | 'date'>): TxDraft => ({
  assetId: 'gold', quantity: '1', unitPrice: '1', fee: '0', ...p,
});

/** همه‌ی مراحل باید موفق باشند؛ در غیر این صورت تست می‌شکند */
function build(drafts: TxDraft[]): Tx[] {
  let txs: Tx[] = [];
  for (const d of drafts) {
    const r = addTx(txs, d);
    assert.equal(r.ok, true, JSON.stringify(r));
    if (r.ok) txs = r.txs;
  }
  return txs;
}

/**
 * سناریوی اصلی (محاسبه‌شده با دست):
 *  ۱. واریز ۲۰۰٬۰۰۰٬۰۰۰
 *  ۲. خرید ۱۰ گرم @ ۵٬۰۰۰٬۰۰۰ + کارمزد ۱۰۰٬۰۰۰ → هزینه ۵۰٬۱۰۰٬۰۰۰
 *  ۳. خرید ۱۰ گرم @ ۶٬۰۰۰٬۰۰۰ → هزینه کل ۱۱۰٬۱۰۰٬۰۰۰، موجودی ۲۰، میانگین ۵٬۵۰۵٬۰۰۰
 *  ۴. فروش ۵ گرم @ ۷٬۰۰۰٬۰۰۰ با کارمزد ۵۰٬۰۰۰ → دریافتی ۳۴٬۹۵۰٬۰۰۰
 *     هزینه خارج‌شده = ۱۱۰٬۱۰۰٬۰۰۰ × ۵ ÷ ۲۰ = ۲۷٬۵۲۵٬۰۰۰ ← سود ۷٬۴۲۵٬۰۰۰
 */
const scenario = (): Tx[] =>
  build([
    { assetId: CASH_ID, type: 'deposit', date: '2026-01-01', quantity: '200000000', unitPrice: '1', fee: '0' },
    draft({ type: 'buy', date: '2026-01-02', quantity: '10', unitPrice: '5000000', fee: '100000' }),
    draft({ type: 'buy', date: '2026-01-03', quantity: '10', unitPrice: '6000000' }),
    draft({ type: 'sell', date: '2026-01-04', quantity: '5', unitPrice: '7000000', fee: '50000' }),
  ]);

/* ----------------------------- Decimal ----------------------------- */

test('Decimal: بدون خطای ممیز شناور', () => {
  assert.ok(D('0.1').plus(D('0.2')).eq(D('0.3')));
  assert.ok(D('1').div(D('3')).mul(D('3')).eq(D('1')));
});

test('Decimal: گرد کردن نیم‌ها از صفر دور می‌شود', () => {
  assert.equal(D('2.5').roundToInt(), 3n);
  assert.equal(D('-2.5').roundToInt(), -3n);
  assert.equal(D('2.4').roundToInt(), 2n);
  assert.equal(D('2.49').roundToInt(), 2n);
  assert.equal(D('0.5').roundToInt(), 1n);
});

test('Decimal: toFixed و parse', () => {
  assert.equal(D('12.345').toFixed(2), '12.35');
  assert.equal(D('-0.5').toFixed(0), '-1');
  assert.equal(D('7').toFixed(2), '7.00');
  assert.equal(D('0.05').toFixed(2), '0.05');
  assert.throws(() => Decimal.parse('abc'));
  assert.throws(() => Decimal.parse(''));
  assert.throws(() => Decimal.parse('1e3'));
  assert.throws(() => D('1').div(D('0')));
});

/* --------------------------- میانگین موزون -------------------------- */

test('میانگین موزون و بهای تمام‌شده پس از دو خرید', () => {
  const txs = scenario().slice(0, 3); // تا پایان خرید دوم
  const s = computeAssetState('gold', txs);
  assert.ok(s.quantity.eq(D('20')));
  assert.ok(s.costBasis.eq(D('110100000')));
  assert.ok(s.avgCost.eq(D('5505000')));
  assert.ok(s.totalBought.eq(D('110000000'))); // بدون کارمزد
  assert.ok(s.totalFees.eq(D('100000')));
});

test('فروش: سود تحقق‌یافته، میانگین ثابت و بهای باقی‌مانده', () => {
  const s = computeAssetState('gold', scenario());
  assert.ok(s.quantity.eq(D('15')));
  assert.ok(s.realizedPnl.eq(D('7425000')));
  assert.ok(s.costBasis.eq(D('82575000')));
  assert.ok(s.avgCost.eq(D('5505000'))); // فروش میانگین را عوض نمی‌کند
  assert.ok(s.totalSold.eq(D('35000000')));
  assert.ok(s.totalFees.eq(D('150000')));
  const sellRow = s.rows[2];
  assert.ok(sellRow.total.eq(D('34950000')));
  assert.ok(sellRow.realizedPnl!.eq(D('7425000')));
});

test('فروش کامل: موجودی و بهای تمام‌شده دقیقاً صفر', () => {
  const txs = build([
    draft({ type: 'buy', date: '2026-01-02', quantity: '10', unitPrice: '5000000', fee: '100000' }),
    draft({ type: 'buy', date: '2026-01-03', quantity: '10', unitPrice: '6000000' }),
    draft({ type: 'sell', date: '2026-01-04', quantity: '20', unitPrice: '6000000' }),
  ]);
  const s = computeAssetState('gold', txs);
  assert.ok(s.quantity.isZero());
  assert.ok(s.costBasis.isZero());
  assert.ok(s.avgCost.isZero());
  assert.ok(s.realizedPnl.eq(D('9900000'))); // ۱۲۰٬۰۰۰٬۰۰۰ − ۱۱۰٬۱۰۰٬۰۰۰
});

test('تقسیم غیرمختوم: مجموع سود دقیقاً برابر دریافتی منهای هزینه است', () => {
  // ۳ واحد @ ۱۰ + کارمزد ۱ → هزینه ۳۱ (میانگین ۱۰٫۳۳۳…)
  const txs = build([
    draft({ type: 'buy', date: '2026-02-01', quantity: '3', unitPrice: '10', fee: '1' }),
    draft({ type: 'sell', date: '2026-02-02', quantity: '1', unitPrice: '20' }),
    draft({ type: 'sell', date: '2026-02-03', quantity: '2', unitPrice: '20' }),
  ]);
  const s = computeAssetState('gold', txs);
  assert.ok(s.quantity.isZero());
  assert.ok(s.costBasis.isZero());
  assert.ok(s.realizedPnl.eq(D('29'))); // ۶۰ − ۳۱، بدون باقی‌مانده‌ی گرد
});

test('مقدار اعشاری (گرم)', () => {
  const txs = build([
    draft({ type: 'buy', date: '2026-02-01', quantity: '2.5', unitPrice: '4000000' }),
    draft({ type: 'sell', date: '2026-02-02', quantity: '0.75', unitPrice: '5000000' }),
  ]);
  const s = computeAssetState('gold', txs);
  assert.ok(s.quantity.eq(D('1.75')));
  assert.ok(s.realizedPnl.eq(D('750000'))); // ۰٫۷۵ × (۵٬۰۰۰٬۰۰۰ − ۴٬۰۰۰٬۰۰۰)
});

/* ------------------------------- نقد ------------------------------- */

test('پیش‌فرض: نقد و دارایی جدا هستند و معامله روی نقد اثر ندارد', () => {
  assert.ok(computeCash(scenario()).balance.eq(D('200000000')));
});


test('برداشت و کمبود نقد', () => {
  const txs = build([
    { assetId: CASH_ID, type: 'deposit', date: '2026-03-01', quantity: '100', unitPrice: '1', fee: '0' },
    { assetId: CASH_ID, type: 'withdraw', date: '2026-03-02', quantity: '40', unitPrice: '1', fee: '0' },
  ]);
  assert.ok(computeCash(txs).balance.eq(D('60')));
  const r = addTx(txs, { assetId: CASH_ID, type: 'withdraw', date: '2026-03-03', quantity: '100', unitPrice: '1', fee: '0' });
  assert.equal(r.ok, true); // هشدار است، نه خطا
  if (r.ok) assert.ok(r.issues.some((i) => i.code === 'NEGATIVE_CASH'));
});

/* --------------------------- اعتبارسنجی ---------------------------- */

test('فروش بیش از موجودی رد می‌شود', () => {
  const txs = scenario();
  const r = addTx(txs, draft({ type: 'sell', date: '2026-01-05', quantity: '15.001', unitPrice: '7000000' }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.issues.some((i) => i.code === 'OVERSELL'));
  // فروش دقیقاً به اندازه‌ی موجودی مجاز است
  assert.equal(addTx(txs, draft({ type: 'sell', date: '2026-01-05', quantity: '15', unitPrice: '7000000' })).ok, true);
});

test('فروش پیش از اولین خرید (به‌خاطر تاریخ) رد می‌شود', () => {
  const txs = build([draft({ type: 'buy', date: '2026-04-10', quantity: '5', unitPrice: '100' })]);
  const r = addTx(txs, draft({ type: 'sell', date: '2026-04-09', quantity: '1', unitPrice: '100' }));
  assert.equal(r.ok, false);
});

test('در یک روز، ترتیب ثبت تعیین‌کننده است', () => {
  const buyFirst = addTx(
    build([draft({ type: 'buy', date: '2026-04-10', quantity: '5', unitPrice: '100' })]),
    draft({ type: 'sell', date: '2026-04-10', quantity: '5', unitPrice: '100' }),
  );
  assert.equal(buyFirst.ok, true);
});

test('اعتبارسنجی فیلدها', () => {
  const base = { id: 't1', seq: 1, assetId: 'gold', type: 'buy' as const, date: '2026-01-01', quantity: '1', unitPrice: '1', fee: '0' };
  assert.equal(validateFields(base).length, 0);
  assert.ok(validateFields({ ...base, quantity: '0' }).length > 0);
  assert.ok(validateFields({ ...base, quantity: '-1' }).length > 0);
  assert.ok(validateFields({ ...base, quantity: 'abc' }).length > 0);
  assert.ok(validateFields({ ...base, unitPrice: '0' }).length > 0);
  assert.ok(validateFields({ ...base, fee: '-5' }).length > 0);
  assert.ok(validateFields({ ...base, date: '1405/01/01' }).length > 0);
  assert.ok(validateFields({ ...base, type: 'deposit' }).length > 0); // واریز برای دارایی
  assert.ok(validateFields({ ...base, assetId: CASH_ID, type: 'buy' }).length > 0); // خرید برای نقد
  assert.equal(
    validateFields({ ...base, assetId: CASH_ID, type: 'deposit', unitPrice: '1' }).length, 0,
  );
});

test('معامله‌ی نامعتبر هرگز به دفتر اضافه نمی‌شود', () => {
  const r = addTx([], draft({ type: 'buy', date: '2026-01-01', quantity: '-3', unitPrice: '10' }));
  assert.equal(r.ok, false);
});

/* ------------------------- ویرایش و حذف --------------------------- */

test('حذف خرید اول: همه‌چیز بازمحاسبه می‌شود', () => {
  const txs = scenario();
  const r = deleteTx(txs, txs[1].id, '2026-01-10T00:00:00Z');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const s = computeAssetState('gold', r.txs);
  assert.ok(s.quantity.eq(D('5')));
  assert.ok(s.avgCost.eq(D('6000000')));
  assert.ok(s.realizedPnl.eq(D('4950000'))); // ۳۴٬۹۵۰٬۰۰۰ − ۳۰٬۰۰۰٬۰۰۰
  assert.ok(computeCash(r.txs).balance.eq(D('200000000')));
});

test('حذفی که موجودی را منفی کند رد می‌شود', () => {
  const txs = scenario();
  const r1 = deleteTx(txs, txs[1].id, 'x');
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const r2 = deleteTx(r1.txs, txs[2].id, 'x'); // هر دو خرید حذف → فروش بی‌پشتوانه
  assert.equal(r2.ok, false);
});

test('ویرایش قیمت خرید، سود را بازمحاسبه می‌کند', () => {
  const txs = scenario();
  const r = updateTx(txs, txs[2].id, { unitPrice: '7000000' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const s = computeAssetState('gold', r.txs);
  assert.ok(s.costBasis.eq(D('90075000'))); // (۵۰٬۱۰۰٬۰۰۰ + ۷۰٬۰۰۰٬۰۰۰) × ۱۵ ÷ ۲۰
  assert.ok(s.avgCost.eq(D('6005000')));
  assert.ok(s.realizedPnl.eq(D('4925000'))); // ۳۴٬۹۵۰٬۰۰۰ − ۳۰٬۰۲۵٬۰۰۰
});

test('ویرایش مقدار فروش به بیش از موجودی رد می‌شود و دفتر دست‌نخورده می‌ماند', () => {
  const txs = scenario();
  const before = JSON.stringify(txs);
  const r = updateTx(txs, txs[3].id, { quantity: '25' });
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(txs), before);
});

test('ویرایش تاریخ فروش به پیش از خریدها رد می‌شود', () => {
  const txs = scenario();
  assert.equal(updateTx(txs, txs[3].id, { date: '2025-12-31' }).ok, false);
});

test('بازیابی معامله‌ی حذف‌شده', () => {
  const txs = scenario();
  const del = deleteTx(txs, txs[3].id, 'x'); // حذف فروش
  assert.equal(del.ok, true);
  if (!del.ok) return;
  assert.ok(computeAssetState('gold', del.txs).quantity.eq(D('20')));
  const back = restoreTx(del.txs, txs[3].id);
  assert.equal(back.ok, true);
  if (back.ok) assert.ok(computeAssetState('gold', back.txs).quantity.eq(D('15')));
});

test('ویرایش معامله‌ی ناموجود', () => {
  assert.equal(updateTx(scenario(), 'nope', { quantity: '1' }).ok, false);
});

/* ------------------------------ پورتفوی ------------------------------ */

const price = (p: string): Record<string, PriceEntry> => ({
  gold: { assetId: 'gold', price: p, source: 'manual', at: '2026-01-05T00:00:00Z' },
});

test('پورتفوی: ارزش روز و سود تحقق‌نیافته', () => {
  const pf = computePortfolio([gold], scenario(), price('6500000'));
  const g = pf.assets[0];
  assert.ok(g.value!.eq(D('97500000')));
  assert.ok(g.unrealized!.eq(D('14925000'))); // ۹۷٬۵۰۰٬۰۰۰ − ۸۲٬۵۷۵٬۰۰۰
  assert.ok(pf.cash.eq(D('200000000')));
  assert.ok(pf.totalValue.eq(D('297500000'))); // ۲۰۰٬۰۰۰٬۰۰۰ نقد + ۹۷٬۵۰۰٬۰۰۰ ارزش ۱۵ گرم
  assert.ok(pf.realizedTotal.eq(D('7425000')));
  assert.ok(pf.unrealizedTotal.eq(D('14925000')));
  assert.deepEqual(pf.missingPrice, []);
});

test('پورتفوی: بدون قیمت، هیچ ارزشی ساخته نمی‌شود', () => {
  const pf = computePortfolio([gold], scenario(), {});
  assert.equal(pf.assets[0].value, null);
  assert.equal(pf.assets[0].unrealized, null);
  assert.deepEqual(pf.missingPrice, ['gold']);
  assert.ok(pf.totalValue.eq(D('200000000'))); // فقط نقد؛ با هشدار ناقص بودن
});

test('پورتفوی: دارایی با موجودی صفر نیازی به قیمت ندارد', () => {
  const txs = build([
    draft({ type: 'buy', date: '2026-01-01', quantity: '2', unitPrice: '10' }),
    draft({ type: 'sell', date: '2026-01-02', quantity: '2', unitPrice: '12' }),
  ]);
  const pf = computePortfolio([gold], txs, {});
  assert.ok(pf.assets[0].value!.isZero());
  assert.deepEqual(pf.missingPrice, []);
  assert.ok(pf.realizedTotal.eq(D('4')));
});

test('اعتبارسنجی کل دفتر برای دفتر سالم خطایی ندارد', () => {
  assert.equal(validateAll(scenario()).filter((i) => i.severity === 'error').length, 0);
});


/* ------------- نقد و دارایی مستقل؛ حقوق و هدیه (درخواست کاربر) ------------- */

const priceOf = (p: string): Record<string, PriceEntry> => ({
  gold: { assetId: 'gold', price: p, source: 'manual', at: '2026-05-03T00:00:00Z' },
});

test('۱۰ میلیون نقد + ۱ گرم طلا جدا؛ خرید دوباره فقط طلا را زیاد می‌کند', () => {
  const txs = build([
    { assetId: CASH_ID, type: 'deposit', date: '2026-05-01', quantity: '100000000', unitPrice: '1', fee: '0' },
    draft({ type: 'buy', date: '2026-05-02', quantity: '1', unitPrice: '260000000' }),
  ]);
  const pf1 = computePortfolio([gold], txs, priceOf('260621000'));
  assert.ok(pf1.cash.eq(D('100000000')));
  assert.ok(pf1.assets[0].value!.eq(D('260621000')));
  assert.ok(pf1.totalValue.eq(D('360621000'))); // نقد + ارزش روز طلا

  const r = addTx(txs, draft({ type: 'buy', date: '2026-05-04', quantity: '1', unitPrice: '261000000' }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.issues, []); // نه هشدار، نه بدهکاری
  const pf2 = computePortfolio([gold], r.txs, priceOf('260621000'));
  assert.ok(pf2.cash.eq(D('100000000'))); // نقد دست‌نخورده
  assert.ok(pf2.assets[0].state.quantity.eq(D('2')));
  assert.ok(pf2.totalValue.eq(D('621242000')));
  // با عوض شدن قیمت روز، فقط ارزش طلا تغییر می‌کند
  assert.ok(computePortfolio([gold], r.txs, priceOf('270000000')).totalValue.eq(D('640000000')));
});

test('خرید وقتی نقد صفر است بدهکاری یا هشدار نمی‌سازد', () => {
  const r = addTx([], draft({ type: 'buy', date: '2026-05-02', quantity: '1', unitPrice: '260000000' }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.issues, []);
  assert.ok(computeCash(r.txs).balance.isZero());
});

test('فروش دارایی هم نقد را تغییر نمی‌دهد؛ سود تحقق‌یافته حساب می‌شود', () => {
  const txs = build([
    draft({ type: 'buy', date: '2026-05-02', quantity: '2', unitPrice: '6000000' }),
    draft({ type: 'sell', date: '2026-05-03', quantity: '1', unitPrice: '7000000', fee: '50000' }),
  ]);
  assert.ok(computeCash(txs).balance.isZero());
  assert.ok(computeAssetState('gold', txs).realizedPnl.eq(D('950000')));
});

test('هدیه‌ی طلا: مقدار زیاد می‌شود، نقد ثابت می‌ماند، پایه‌ی هزینه ارزش روز دریافت است', () => {
  const txs = build([
    { assetId: CASH_ID, type: 'deposit', date: '2026-05-01', quantity: '100000000', unitPrice: '1', fee: '0' },
    draft({ type: 'buy', date: '2026-05-02', quantity: '1', unitPrice: '200000000' }),
    draft({ type: 'receive', date: '2026-05-03', quantity: '1', unitPrice: '240000000' }),
  ]);
  const s = computeAssetState('gold', txs);
  assert.ok(s.quantity.eq(D('2')));
  assert.ok(s.avgCost.eq(D('220000000')));
  assert.ok(s.totalBought.eq(D('200000000'))); // هدیه جزو «مجموع خرید» نیست
  assert.ok(computeCash(txs).balance.eq(D('100000000')));
  const pf = computePortfolio([gold], txs, priceOf('250000000'));
  assert.ok(pf.assets[0].unrealized!.eq(D('60000000'))); // ۵۰۰٬۰۰۰٬۰۰۰ − ۴۴۰٬۰۰۰٬۰۰۰
  assert.ok(pf.totalValue.eq(D('600000000')));
});

test('حقوق ماهانه نقد را زیاد می‌کند و بخشی طلا شدن آن به نقد دست نمی‌زند', () => {
  const txs = build([
    { assetId: CASH_ID, type: 'deposit', date: '2026-05-01', quantity: '500000000', unitPrice: '1', fee: '0' }, // حقوق
    draft({ type: 'buy', date: '2026-05-02', quantity: '1', unitPrice: '260000000' }),
  ]);
  const pf = computePortfolio([gold], txs, priceOf('260000000'));
  assert.ok(pf.cash.eq(D('500000000')));
  assert.ok(pf.totalValue.eq(D('760000000')));
});

test('دریافت برای نقد و واریز برای دارایی مجاز نیست', () => {
  assert.equal(addTx([], { assetId: CASH_ID, type: 'receive', date: '2026-05-01', quantity: '1', unitPrice: '1', fee: '0' }).ok, false);
  assert.equal(addTx([], draft({ type: 'deposit', date: '2026-05-01' })).ok, false);
});

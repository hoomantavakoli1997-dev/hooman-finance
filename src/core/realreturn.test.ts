import test from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from './decimal';
import { computeAssetState } from './engine';
import { PriceEntry, Tx } from './types';
import { computeRealReturn, heldLots, logPrices, priceNear, refPoints, PriceLog } from './realreturn';

let seq = 0;
const tx = (assetId: string, type: Tx['type'], date: string, quantity: string, unitPrice: string, fee = '0'): Tx =>
  ({ id: 't' + ++seq, seq, assetId, type, date, quantity, unitPrice, fee });
const pe = (price: string, source: 'auto' | 'manual' = 'auto'): PriceEntry => ({ assetId: 'x', price, source, at: '2026-11-01T00:00:00Z' });
const D = (s: string) => Decimal.of(s);

test('سهم باقی‌مانده‌ی خریدها پس از فروش با موتور محاسبات یکی است', () => {
  const txs = [
    tx('gold', 'buy', '2026-01-01', '10', '100', '5'),
    tx('gold', 'sell', '2026-02-01', '4', '150'),
    tx('gold', 'buy', '2026-03-01', '6', '120'),
    tx('gold', 'sell', '2026-04-01', '3', '130'),
  ];
  const lots = heldLots('gold', txs);
  const st = computeAssetState('gold', txs);
  assert.equal(lots.reduce((a, l) => a.plus(l.cost), D('0')).toString(), st.costBasis.toString());
  assert.equal(lots.reduce((a, l) => a.plus(l.qty), D('0')).toString(), st.quantity.toString());
});

test('فروش کامل همه‌ی خریدها را پاک می‌کند', () => {
  const txs = [tx('gold', 'buy', '2026-01-01', '2', '100'), tx('gold', 'sell', '2026-02-01', '2', '120')];
  assert.equal(heldLots('gold', txs).length, 0);
});

test('priceNear: نزدیک‌ترین قیمت در بازه، وگرنه null', () => {
  const pts = [{ date: '2026-01-01', price: D('100') }, { date: '2026-06-01', price: D('200') }];
  assert.equal(priceNear(pts, '2026-01-10')!.toString(), '100');
  assert.equal(priceNear(pts, '2026-05-20')!.toString(), '200');
  assert.equal(priceNear(pts, '2026-03-15'), null);
});

test('logPrices فقط قیمت خودکار را ثبت می‌کند', () => {
  const log: PriceLog = {};
  assert.equal(logPrices(log, ['usd', 'gold'], { usd: pe('100'), gold: pe('200', 'manual') }), true);
  assert.deepEqual(log, { '2026-11-01': { usd: '100' } });
  assert.equal(logPrices(log, ['usd'], { usd: pe('100') }), false);
});

test('سود واقعی: طلا ۲۰٪ بالا، دلار ۱۰٪ بالا ⇒ نسبت به دلار ≈ ۹٫۰۹٪', () => {
  const txs = [tx('gold', 'buy', '2026-01-01', '1', '1000')];
  const log: PriceLog = { '2026-01-01': { usd: '100', gold: '1000' } };
  const prices = { gold: pe('1200'), usd: pe('110') };
  const r = computeRealReturn(['gold', 'usd'], txs, prices, log, '2026-11-01', null)!;
  assert.equal(r.nominal.toFixed(4), '0.2000');
  assert.equal(r.usd!.bench.toFixed(4), '0.1000');
  assert.equal(r.usd!.real.toFixed(4), '0.0909');
  assert.equal(r.gold!.real.toFixed(4), '0.0000');
  assert.equal(r.inflation, null);
  assert.equal(r.usd!.coverage, 1);
});

test('بدون قیمت مرجع نزدیک، مقایسه نمی‌آید و پوشش جزئی گزارش می‌شود', () => {
  const txs = [tx('gold', 'buy', '2026-01-01', '1', '1000'), tx('gold', 'buy', '2026-08-01', '1', '1000')];
  const log: PriceLog = { '2026-08-01': { usd: '100' } };
  const r = computeRealReturn(['gold'], txs, { gold: pe('1100'), usd: pe('105') }, log, '2026-11-01', null)!;
  assert.equal(r.usd!.coverage, 0.5);
  assert.equal(r.usd!.bench.toFixed(4), '0.0500');
  assert.equal(r.gold!.bench.toFixed(4), '0.1000'); // خریدها خودشان مرجع طلا هستند
  assert.equal(r.gold!.real.toFixed(4), '0.0000');
});

test('تورم: نرخ سالانه‌ی ۴۰٪ برای یک سال', () => {
  const txs = [tx('gold', 'buy', '2025-11-01', '1', '1000')];
  const r = computeRealReturn(['gold'], txs, { gold: pe('1400') }, {}, '2026-11-01', 40)!;
  assert.equal(r.inflation!.bench.toFixed(2), '0.40');
  assert.equal(r.inflation!.real.toFixed(2), '0.00');
  assert.equal(r.usd, null);
});

test('دارایی بدون قیمت کنار گذاشته می‌شود و گزارش می‌شود', () => {
  const txs = [tx('gold', 'buy', '2026-01-01', '1', '1000'), tx('usd', 'buy', '2026-01-01', '5', '100')];
  const r = computeRealReturn(['gold', 'usd'], txs, { gold: pe('1100') }, {}, '2026-11-01', null)!;
  assert.deepEqual(r.missingPrice, ['usd']);
  assert.equal(r.cost.toString(), '1000');
});

test('بدون موجودی ⇒ null', () => {
  assert.equal(computeRealReturn(['gold'], [], {}, {}, '2026-11-01', null), null);
});

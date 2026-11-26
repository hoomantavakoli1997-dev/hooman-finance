import test from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from './decimal';
import { assetOpportunity, priceSeries } from './assetinsight';
import { Tx } from './types';

const near = (d: Decimal | null, n: number, tol = 0.001) => d !== null && Math.abs(d.toNumber() - n) < tol;
const buy = (date: string, q: string, p: string): Tx => ({ id: 't' + date, seq: 1, assetId: 'gold', type: 'buy', date, quantity: q, unitPrice: p, fee: '0' } as Tx);

test('بانک و تورم: یک خرید یک‌ساله', () => {
  const o = assetOpportunity('gold', [buy('2025-11-25', '10', '10')], Decimal.of('15'), '2026-11-25', 20, 40)!;
  assert.equal(o.cost.toString(), '100');
  assert.equal(o.value.toString(), '150');
  assert.ok(near(o.bankValue, 120));
  assert.ok(near(o.vsBank, 0.25, 0.0001));
  assert.ok(near(o.inflValue, 140));
  assert.ok(near(o.real, 150 / 140 - 1, 0.0001));
  assert.equal(o.avgDays, 365);
  assert.equal(o.avgCost.toString(), '10');
});
test('بدون نرخ، مقایسه‌ای ساخته نمی‌شود', () => {
  const o = assetOpportunity('gold', [buy('2026-01-01', '1', '10')], Decimal.of('12'), '2026-11-25', null, null)!;
  assert.equal(o.bankValue, null); assert.equal(o.vsBank, null); assert.equal(o.real, null);
  assert.ok(near(o.nominal, 0.2, 1e-9));
});
test('بدون قیمت روز یا موجودی: null', () => {
  assert.equal(assetOpportunity('gold', [buy('2026-01-01', '1', '10')], null, '2026-11-25', 20, 20), null);
  assert.equal(assetOpportunity('gold', [], Decimal.of('1'), '2026-11-25', 20, 20), null);
});
test('مدت نگهداری وزن‌دار با مبلغ', () => {
  const o = assetOpportunity('gold', [buy('2026-11-15', '1', '100'), buy('2026-10-26', '1', '100')], Decimal.of('100'), '2026-11-25', 0, 0)!;
  assert.equal(o.avgDays, 20);
});
test('سری قیمت فقط از گزارش و مرتب', () => {
  const s = priceSeries('gold', { '2026-02-02': { gold: '200' }, '2026-02-01': { gold: '100', usd: '5' }, '2026-02-03': { usd: '7' } });
  assert.deepEqual(s.map((p) => p.date), ['2026-02-01', '2026-02-02']);
});

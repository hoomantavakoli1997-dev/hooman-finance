import test from 'node:test';
import assert from 'node:assert/strict';
import { addTx, computePortfolio } from './engine';
import { computeAllocation, allocId } from './allocation';
import { Asset, PriceEntry, Tx } from './types';

const assets: Asset[] = [
  { id: 'gold', name: 'طلا', unit: 'گرم', kind: 'metal', decimals: 3 },
  { id: 'usd', name: 'دلار', unit: 'دلار', kind: 'currency', decimals: 2 },
  { id: 'fool', name: 'فولاد', unit: 'سهم', kind: 'custom', decimals: 0, priceKeys: { tsetmc: '123' } },
  { id: 'misc', name: 'ملک', unit: 'متر', kind: 'custom', decimals: 0 },
];
const pe = (price: string): PriceEntry => ({ assetId: 'x', price, source: 'manual', at: '2026-11-01T00:00:00Z' });

function txs(): Tx[] {
  let t: Tx[] = [];
  const add = (d: Parameters<typeof addTx>[1]) => { t = addTx(t, d).txs; };
  add({ assetId: 'cash', type: 'deposit', date: '2026-01-01', quantity: '100000', unitPrice: '1', fee: '0' });
  add({ assetId: 'gold', type: 'buy', date: '2026-01-02', quantity: '1', unitPrice: '1000', fee: '0' });
  add({ assetId: 'usd', type: 'buy', date: '2026-01-02', quantity: '10', unitPrice: '100', fee: '0' });
  add({ assetId: 'fool', type: 'buy', date: '2026-01-02', quantity: '5', unitPrice: '10', fee: '0' });
  add({ assetId: 'misc', type: 'buy', date: '2026-01-02', quantity: '1', unitPrice: '500', fee: '0' });
  return t;
}

test('دسته‌بندی دارایی‌ها', () => {
  assert.equal(allocId('metal', false), 'gold');
  assert.equal(allocId('custom', true), 'stock');
  assert.equal(allocId('custom', false), 'other');
  assert.equal(allocId('crypto', false), 'crypto');
});

test('سهم‌ها جمعشان ۱۰۰ و ترتیب ثابت است', () => {
  const prices = { gold: pe('2000'), usd: pe('100'), fool: pe('10'), misc: pe('500') };
  const pf = computePortfolio(assets, txs(), prices);
  const a = computeAllocation(pf);
  // نقد مستقل است (خرید نقد را کم نمی‌کند): ۱۰۰٬۰۰۰ + ۲۰۰۰ + ۱۰۰۰ + ۵۰ + ۵۰۰
  assert.equal(a.slices.map((s) => s.id).join(), 'cash,gold,currency,stock,other');
  assert.ok(Math.abs(a.slices.reduce((x, s) => x + s.pct, 0) - 100) < 1e-9);
  assert.equal(a.slices.find((s) => s.id === 'gold')!.value.toString(), '2000');
  assert.equal(a.total.toString(), '103550');
});

test('دارایی بدون قیمت در ترکیب نمی‌آید و گزارش می‌شود', () => {
  const pf = computePortfolio(assets, txs(), { gold: pe('2000') });
  const a = computeAllocation(pf);
  assert.ok(!a.slices.some((s) => s.id === 'currency'));
  assert.ok(a.unpriced.includes('usd'));
});

test('پرتفوی خالی ⇒ بدون برش', () => {
  const a = computeAllocation(computePortfolio(assets, [], {}));
  assert.equal(a.slices.length, 0);
});

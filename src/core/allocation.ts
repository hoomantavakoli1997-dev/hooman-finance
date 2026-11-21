/**
 * ترکیب دارایی‌ها: سهم هر دسته (نقد، طلا و فلزات، ارز، رمزارز، سهام، سایر) از ارزش کل.
 * فقط دارایی‌های دارای قیمت و موجودی مثبت می‌آیند؛ دارایی بدون قیمت جداگانه گزارش می‌شود.
 */
import { Decimal } from './decimal';
import type { Portfolio } from './engine';
import { CASH_ID } from './types';

export type AllocId = 'cash' | 'gold' | 'currency' | 'stock' | 'crypto' | 'other';
export const ALLOC_LABEL: Record<AllocId, string> = {
  cash: 'نقد', gold: 'طلا و فلزات', currency: 'ارز', stock: 'سهام بورس', crypto: 'رمزارز', other: 'سایر',
};
/** ترتیب ثابت: رنگ هر دسته هرگز با تغییر داده‌ها عوض نمی‌شود */
export const ALLOC_ORDER: AllocId[] = ['cash', 'gold', 'currency', 'stock', 'crypto', 'other'];

export interface Slice { id: AllocId; label: string; value: Decimal; pct: number }
export interface Allocation { total: Decimal; slices: Slice[]; unpriced: string[] }

export function allocId(kind: string, hasTsetmc: boolean): AllocId {
  if (kind === 'metal') return 'gold';
  if (kind === 'currency') return 'currency';
  if (kind === 'crypto') return 'crypto';
  if (hasTsetmc) return 'stock';
  return 'other';
}

export function computeAllocation(pf: Portfolio): Allocation {
  const sums = new Map<AllocId, Decimal>();
  const add = (id: AllocId, v: Decimal) => sums.set(id, (sums.get(id) ?? Decimal.ZERO).plus(v));
  if (pf.cash.gt(0)) add('cash', pf.cash);
  for (const a of pf.assets) {
    if (a.asset.id === CASH_ID || !a.value || !a.value.gt(0)) continue;
    add(allocId(a.asset.kind, !!a.asset.priceKeys?.tsetmc), a.value);
  }
  let total = Decimal.ZERO;
  for (const v of sums.values()) total = total.plus(v);
  const slices: Slice[] = [];
  if (total.gt(0)) {
    for (const id of ALLOC_ORDER) {
      const v = sums.get(id);
      if (v) slices.push({ id, label: ALLOC_LABEL[id], value: v, pct: v.div(total).mul(100).toNumber() });
    }
  }
  return { total, slices, unpriced: pf.missingPrice };
}

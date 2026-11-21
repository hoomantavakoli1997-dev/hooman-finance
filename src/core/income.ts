/**
 * درآمدهای نقدی: سود سهام، سود سپرده‌ی بانکی و سود روزشمار.
 * این‌ها واریز نقد با برچسب درآمد هستند؛ موتور محاسبات نقد دست‌نخورده می‌ماند و جمع نقد درست می‌شود.
 */
import { Decimal } from './decimal';
import { TxDraft, activeTx } from './engine';
import { CASH_ID, Tx } from './types';
import { daysBetween, isIso } from './reminders';

export type IncomeKind = 'dividend' | 'deposit' | 'accrual';
export const INCOME_LABEL: Record<IncomeKind, string> = {
  dividend: 'سود سهام', deposit: 'سود سپرده', accrual: 'سود روزشمار',
};

export function incomeDraft(kind: IncomeKind, date: string, amountRial: Decimal, source: string, note?: string): TxDraft {
  return {
    assetId: CASH_ID, type: 'deposit', date, quantity: amountRial.toString(), unitPrice: '1', fee: '0',
    income: kind, source: source.trim() || undefined, note: note?.trim() || undefined,
  };
}

export function validateIncome(date: string, amountRial: Decimal): string | null {
  if (!isIso(date)) return 'تاریخ معتبر نیست.';
  if (!amountRial.gt(0)) return 'مبلغ باید بیشتر از صفر باشد.';
  return null;
}

/** سود روزشمار: اصل × نرخ سالانه × روز ÷ ۳۶۵، گرد به ریال. از `from` (شامل) تا `to` (غیرشامل). */
export function accrualInterest(principalRial: Decimal, annualPct: Decimal, from: string, to: string): Decimal | null {
  if (!isIso(from) || !isIso(to) || !principalRial.gt(0) || annualPct.isNegative()) return null;
  const days = daysBetween(from, to);
  if (days <= 0) return null;
  return principalRial.mul(annualPct).div(100).mul(days).div(365).round(0);
}

export interface IncomeTotals { dividend: Decimal; deposit: Decimal; accrual: Decimal; total: Decimal }

/** جمع درآمدها در بازه‌ی [from, to] (هر دو شامل) */
export function incomeTotals(txs: Tx[], from: string, to: string): IncomeTotals {
  const out: IncomeTotals = { dividend: Decimal.ZERO, deposit: Decimal.ZERO, accrual: Decimal.ZERO, total: Decimal.ZERO };
  for (const t of activeTx(txs)) {
    if (!t.income || t.assetId !== CASH_ID || t.type !== 'deposit') continue;
    if (t.date < from || t.date > to) continue;
    let q: Decimal;
    try { q = Decimal.parse(t.quantity); } catch { continue; }
    out[t.income] = out[t.income].plus(q);
    out.total = out.total.plus(q);
  }
  return out;
}

export function incomeTxs(txs: Tx[]): Tx[] {
  return activeTx(txs).filter((t) => t.income && t.assetId === CASH_ID).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.seq - a.seq));
}

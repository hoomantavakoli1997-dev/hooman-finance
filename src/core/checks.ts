import { Decimal } from './decimal';
import { CASH_ID } from './types';
import type { TxDraft } from './engine';

export type CheckDirection = 'received' | 'issued';
export type CheckStatus = 'pending' | 'deposited' | 'cleared' | 'bounced' | 'cancelled';

export interface Cheque {
  id: string;
  direction: CheckDirection;
  number: string;
  bank: string;
  accountHolder: string;
  amount: string;
  issueDate: string;
  dueDate: string;
  status: CheckStatus;
  note?: string;
  reminderId?: string;
  /** معامله‌ی نقدی که با «وصول‌شده» ساخته شده است */
  cashTxId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckValidation {
  valid: boolean;
  error?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function validateCheque(c: Omit<Cheque, 'id' | 'createdAt' | 'updatedAt'>): CheckValidation {
  if (!c.number.trim()) return { valid: false, error: 'شماره چک را وارد کنید.' };
  if (!c.bank.trim()) return { valid: false, error: 'نام بانک را وارد کنید.' };
  if (!c.accountHolder.trim()) return { valid: false, error: 'نام صاحب حساب را وارد کنید.' };
  try {
    const amount = Decimal.parse(c.amount);
    if (!amount.isInteger() || amount.lte(0)) return { valid: false, error: 'مبلغ چک باید عدد صحیح و بیشتر از صفر باشد.' };
  } catch {
    return { valid: false, error: 'مبلغ چک معتبر نیست.' };
  }
  if (!ISO.test(c.issueDate) || !ISO.test(c.dueDate)) return { valid: false, error: 'تاریخ صدور یا سررسید معتبر نیست.' };
  if (c.dueDate < c.issueDate) return { valid: false, error: 'تاریخ سررسید نمی‌تواند قبل از تاریخ صدور باشد.' };
  if (!['pending','deposited','cleared','bounced','cancelled'].includes(c.status)) return { valid: false, error: 'وضعیت چک معتبر نیست.' };
  return { valid: true };
}

export function chequeOutstanding(c: Cheque): boolean {
  return c.status === 'pending' || c.status === 'deposited' || c.status === 'bounced';
}

export function chequeDue(c: Cheque, today: string): 'overdue' | 'today' | 'upcoming' | 'closed' {
  if (!chequeOutstanding(c)) return 'closed';
  if (c.dueDate < today) return 'overdue';
  if (c.dueDate === today) return 'today';
  return 'upcoming';
}

export function sortCheques(items: Cheque[]): Cheque[] {
  const rank: Record<CheckStatus, number> = { bounced: 0, pending: 1, deposited: 2, cleared: 3, cancelled: 4 };
  return [...items].sort((a, b) => {
    const status = rank[a.status] - rank[b.status];
    return status || a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt);
  });
}

/**
 * طلب و بدهی ناشی از چک‌های باز (برای سرمایه‌ی خالص):
 * چک دریافتیِ برگشتی قابل‌وصول حساب نمی‌شود؛ چک پرداختیِ برگشتی همچنان بدهی است.
 */
export function chequeTotals(list: Cheque[]): { receivable: Decimal; payable: Decimal } {
  let receivable = Decimal.ZERO;
  let payable = Decimal.ZERO;
  for (const c of list) {
    const amount = Decimal.parse(c.amount);
    if (c.direction === 'received' && (c.status === 'pending' || c.status === 'deposited')) receivable = receivable.plus(amount);
    if (c.direction === 'issued' && chequeOutstanding(c)) payable = payable.plus(amount);
  }
  return { receivable, payable };
}

/** معامله‌ی نقدی هنگام وصول چک: دریافتی ← واریز، پرداختی ← برداشت (به ریال) */
export function chequeCashDraft(c: Cheque, date: string): TxDraft {
  return {
    assetId: CASH_ID,
    type: c.direction === 'received' ? 'deposit' : 'withdraw',
    date,
    quantity: c.amount,
    unitPrice: '1',
    fee: '0',
    note: `وصول چک ${c.number}`,
  };
}

/** آیا چک مشابهی (همان شماره، بانک و نوع) قبلاً ثبت شده است؟ */
export function duplicateCheque(list: Cheque[], c: Pick<Cheque, 'number' | 'bank' | 'direction'>, exceptId?: string): boolean {
  const norm = (x: string) => x.replace(/\s+/g, '').toLowerCase();
  return list.some((o) => o.id !== exceptId && o.status !== 'cancelled' && o.direction === c.direction && norm(o.number) === norm(c.number) && norm(o.bank) === norm(c.bank));
}

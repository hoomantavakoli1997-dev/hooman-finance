import { Decimal } from './decimal';

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

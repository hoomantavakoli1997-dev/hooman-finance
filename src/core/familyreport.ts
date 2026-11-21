/**
 * گزارش فقط‌خواندنی برای خانواده: متن ساده‌ی بدون رمز، قفل، یادداشت و شماره چک.
 * پیش‌فرض: بدون مبلغ و بدون نام؛ فقط درصد ترکیب دارایی و تعداد تعهدات پیش‌رو.
 */
import { Decimal } from './decimal';
import type { Allocation } from './allocation';

export interface FamilyOpts {
  /** مبلغ‌ها نمایش داده شود */
  amounts: boolean;
  /** نام اشخاص و صاحبان چک نمایش داده شود */
  names: boolean;
  /** قسط‌ها و چک‌های پیش‌رو آورده شود */
  commitments: boolean;
}

export interface FamilyItem {
  kind: 'installment-in' | 'installment-out' | 'cheque-in' | 'cheque-out';
  /** برچسب با نام (فقط وقتی names روشن است استفاده می‌شود) */
  label: string;
  due: string;
  /** ریال */
  amount: Decimal;
}

export interface FamilyInput {
  dateLabel: string;
  worth: Decimal;
  alloc: Allocation;
  items: FamilyItem[];
  today: string;
  fmtMoney: (rial: Decimal) => string;
  fmtDate: (iso: string) => string;
  opts: FamilyOpts;
  /** افق تعهدات (روز) */
  horizonDays?: number;
}

const GENERIC: Record<FamilyItem['kind'], string> = {
  'installment-in': 'قسطِ دریافتی',
  'installment-out': 'قسطِ پرداختی',
  'cheque-in': 'چکِ دریافتی',
  'cheque-out': 'چکِ پرداختی',
};

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function familyReportText(i: FamilyInput): string {
  const L: string[] = [];
  L.push('گزارش دارایی خانواده — دارا');
  L.push(`تاریخ: ${i.dateLabel}`);
  L.push('');
  if (i.opts.amounts) {
    L.push(`سرمایه‌ی خالص: ${i.fmtMoney(i.worth)}`);
    L.push('');
  }
  if (i.alloc.slices.length) {
    L.push('ترکیب دارایی‌ها:');
    for (const s of i.alloc.slices) {
      const pct = s.pct.toFixed(1).replace('.', '٫');
      L.push(`• ${s.label}: ${pct}٪${i.opts.amounts ? ` (${i.fmtMoney(s.value)})` : ''}`);
    }
    L.push('');
  }
  if (i.opts.commitments) {
    const limit = addDays(i.today, i.horizonDays ?? 30);
    const list = i.items.filter((x) => x.due <= limit).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    L.push(`تعهدات تا ${i.horizonDays ?? 30} روز آینده:`);
    if (!list.length) L.push('• موردی نیست.');
    for (const x of list) {
      const late = x.due < i.today ? ' (گذشته)' : '';
      const who = i.opts.names ? x.label : GENERIC[x.kind];
      L.push(`• ${who} — ${i.fmtDate(x.due)}${late}${i.opts.amounts ? ` — ${i.fmtMoney(x.amount)}` : ''}`);
    }
    L.push('');
  }
  L.push('این گزارش فقط برای مشاهده است و تصویر لحظه‌ی ساخت آن را نشان می‌دهد. رمز، قفل، یادداشت‌ها و شماره‌ی چک‌ها در آن نیست.');
  return L.join('\n');
}

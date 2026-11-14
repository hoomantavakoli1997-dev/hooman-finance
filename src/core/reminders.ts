/**
 * یادآورها: قسط‌های پیش‌رو (خودکار از وام‌ها)، یادآور تاریخ دلخواه، و هشدار قیمت برای خرید/فروش.
 * هسته‌ی خالص (بدون وابستگی به رابط)؛ تاریخ‌ها ISO میلادی و قیمت‌ها ریال.
 */
import { Decimal } from './decimal';
import { parseDec } from './engine';
import { Debt, DebtPayment, computeDebt } from './people';

export interface DateReminder {
  id: string;
  kind: 'date';
  title: string;
  /** تاریخ رویداد (ISO) */
  date: string;
  note?: string;
  /** چند روز زودتر یادآوری شود (۰ = همان روز) */
  leadDays: number;
  done?: boolean;
}

export type PriceCond = 'above' | 'below';

export interface PriceReminder {
  id: string;
  kind: 'price';
  assetId: string;
  /** هدف کاربر؛ فقط برچسب است: خرید یا فروش */
  side: 'buy' | 'sell';
  /** above: وقتی قیمت به این عدد یا بالاتر رسید؛ below: به این عدد یا پایین‌تر */
  cond: PriceCond;
  /** ریال به ازای هر واحد */
  target: string;
  note?: string;
  /** وقتی هشدار فعال شد (ISO)؛ هر هشدار فقط یک بار فعال می‌شود */
  firedAt?: string;
  /** کاربر هشدار فعال‌شده را دیده است */
  seen?: boolean;
}

export type Reminder = DateReminder | PriceReminder;

export interface ReminderSettings {
  /** یادآوری خودکار اقساط */
  installments: boolean;
  /** چند روز قبل از سررسید قسط */
  installmentLead: number;
  /** ساعت اعلان (۰ تا ۲۳، به وقت گوشی) */
  hour: number;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { installments: true, installmentLead: 1, hour: 9 };
export const LEAD_OPTIONS = [0, 1, 2, 3, 7];

/* ------------------------------ تاریخ ------------------------------ */

const DAY = 86_400_000;

function utcMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDaysIso(iso: string, n: number): string {
  return new Date(utcMs(iso) + n * DAY).toISOString().slice(0, 10);
}

/** تعداد روز از a تا b (b − a) */
export function daysBetween(a: string, b: string): number {
  return Math.round((utcMs(b) - utcMs(a)) / DAY);
}

export function isIso(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDaysIso(s, 0) === s;
}

/* ------------------------------ رویدادها ------------------------------ */

export interface ReminderEvent {
  /** کلید پایدار؛ برای جلوگیری از تکرار اعلان */
  id: string;
  kind: 'installment' | 'date';
  title: string;
  body: string;
  /** سررسید/تاریخ رویداد */
  dueDate: string;
  /** روزی که باید یادآوری شروع شود */
  remindOn: string;
  /** ریال (فقط برای قسط) */
  amount?: string;
}

/** اقساط پرداخت‌نشده‌ی همه‌ی وام‌ها، تا `horizonDays` روز بعد (و عقب‌افتاده‌ها). */
export function installmentEvents(
  debts: Debt[], payments: DebtPayment[], personName: (id: string) => string,
  s: ReminderSettings, todayIso: string, horizonDays = 60,
): ReminderEvent[] {
  if (!s.installments) return [];
  const out: ReminderEvent[] = [];
  const limit = addDaysIso(todayIso, horizonDays);
  for (const debt of debts) {
    if (debt.deletedAt) continue;
    const ds = computeDebt(debt, payments, todayIso);
    if (ds.settled) continue;
    const who = personName(debt.personId);
    for (const r of ds.schedule) {
      if (r.status === 'paid' || r.dueDate > limit) continue;
      const left = r.amount.minus(r.paidPart);
      if (left.lte(0)) continue;
      const pay = debt.direction === 'borrowed';
      out.push({
        id: `inst:${debt.id}:${r.index}`,
        kind: 'installment',
        title: pay ? `سررسید قسط ${debt.title}` : `دریافت قسط از ${who}`,
        body: pay ? `قسط ${r.index} به ${who}` : `قسط ${r.index} ${debt.title}`,
        dueDate: r.dueDate,
        remindOn: addDaysIso(r.dueDate, -Math.max(0, s.installmentLead)),
        amount: left.toString(),
      });
    }
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

export function dateEvents(list: Reminder[], todayIso: string): ReminderEvent[] {
  const out: ReminderEvent[] = [];
  for (const r of list) {
    if (r.kind !== 'date' || r.done) continue;
    out.push({
      id: `date:${r.id}`, kind: 'date', title: r.title, body: r.note ?? '',
      dueDate: r.date, remindOn: addDaysIso(r.date, -Math.max(0, r.leadDays)),
    });
  }
  void todayIso;
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

/** رویدادهایی که الان باید دیده شوند: زمان یادآوری رسیده (یا گذشته) */
export function activeEvents(events: ReminderEvent[], todayIso: string): ReminderEvent[] {
  return events.filter((e) => e.remindOn <= todayIso);
}

/** اعلان‌هایی که باید زمان‌بندی شوند: فقط آینده. `at` زمان محلی (میلی‌ثانیه). */
export interface ScheduledNote { id: string; title: string; body: string; at: number }

export function scheduleNotes(events: ReminderEvent[], hour: number, now: number = Date.now()): ScheduledNote[] {
  const h = Math.min(23, Math.max(0, Math.floor(hour)));
  const out: ScheduledNote[] = [];
  for (const e of events) {
    const [y, m, d] = e.remindOn.split('-').map(Number);
    const at = new Date(y, m - 1, d, h, 0, 0, 0).getTime(); // ساعت محلی گوشی
    if (at > now + 30_000) out.push({ id: e.id, title: e.title, body: e.body, at });
  }
  // اندروید برای هر اپ تعداد زمان‌بندی را محدود می‌کند؛ نزدیک‌ترین‌ها را نگه می‌داریم
  return out.sort((a, b) => a.at - b.at).slice(0, 48);
}

/* ------------------------------ هشدار قیمت ------------------------------ */

export function priceHit(r: PriceReminder, price: Decimal): boolean {
  if (price.lte(0)) return false;
  const t = parseDec(r.target);
  if (!t) return false;
  return r.cond === 'above' ? price.gte(t) : price.lte(t);
}

export function validateReminder(r: Reminder): string | null {
  if (r.kind === 'date') {
    if (!r.title.trim()) return 'عنوان یادآور را بنویسید.';
    if (!isIso(r.date)) return 'تاریخ معتبر نیست.';
    if (!Number.isInteger(r.leadDays) || r.leadDays < 0 || r.leadDays > 30) return 'تعداد روز یادآوری معتبر نیست.';
    return null;
  }
  const t = parseDec(r.target);
  if (!t) return 'قیمت هدف معتبر نیست.';
  if (!t.gt(0)) return 'قیمت هدف باید بیشتر از صفر باشد.';
  if (!r.assetId) return 'دارایی را انتخاب کنید.';
  return null;
}

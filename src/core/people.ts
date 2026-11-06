import { Decimal } from './decimal';
import { parseDec } from './engine';
import { isoToJalali, jalaliToIso } from './jalali';

/**
 * اشخاص، وام/قرض و اقساط.
 * مبالغ به ریال و به‌صورت رشته‌ی اعشاری. مانده و وضعیت هیچ‌وقت ذخیره نمی‌شود و از روی پرداخت‌ها محاسبه می‌شود.
 */

export interface Person {
  id: string;
  name: string;
  note?: string;
  deletedAt?: string | null;
}

/** lent = من داده‌ام (او به من بدهکار است)؛ borrowed = من گرفته‌ام (من بدهکارم) */
export type Direction = 'lent' | 'borrowed';

export interface InstallmentPlan {
  /** تعداد اقساط */
  count: number;
  /** مبلغ هر قسط (ریال)؛ قسط آخر باقی‌مانده‌ی مبلغ کل را می‌گیرد */
  installment: string;
  /** تاریخ سررسید قسط اول (میلادی) */
  firstDate: string;
  /** فاصله‌ی اقساط به ماه (معمولاً ۱) */
  everyMonths: number;
}

export interface Debt {
  id: string;
  personId: string;
  direction: Direction;
  /** عنوان، مثلاً «وام بلو بانک» یا «قرض» */
  title: string;
  /** مبلغ کلی که باید برگردانده شود (برای وام بانکی با سود، جمع کل بازپرداخت) */
  amount: string;
  /** تاریخ دریافت/پرداخت وام (میلادی) */
  date: string;
  plan?: InstallmentPlan;
  /** اگر روشن باشد: گرفتن وام نقد را زیاد و دادن وام نقد را کم می‌کند */
  fromCash?: boolean;
  note?: string;
  deletedAt?: string | null;
}

export interface DebtPayment {
  id: string;
  debtId: string;
  date: string;
  amount: string;
  /** اگر روشن باشد: پرداخت من نقد را کم و دریافت من نقد را زیاد می‌کند */
  fromCash?: boolean;
  note?: string;
  deletedAt?: string | null;
}

export interface PeopleData {
  people: Person[];
  debts: Debt[];
  payments: DebtPayment[];
}

export interface PeopleIssue {
  code: 'BAD_FIELD' | 'OVERPAY' | 'BEFORE_START' | 'BAD_PLAN' | 'NO_PERSON';
  id: string;
  message: string;
}

const ZERO = Decimal.ZERO;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const live = <T extends { deletedAt?: string | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt);

/* ------------------------------ تاریخ ------------------------------ */

/** افزودن ماه شمسی؛ اگر روز در ماه مقصد وجود نداشت به آخرین روز همان ماه می‌رود */
export function addJalaliMonths(iso: string, months: number): string {
  const j = isoToJalali(iso);
  if (!j) throw new Error(`تاریخ نامعتبر: ${iso}`);
  const total = j.y * 12 + (j.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  for (let d = j.d; d >= 1; d--) {
    const r = jalaliToIso(y, m, d);
    if (r) return r;
  }
  throw new Error('محاسبه‌ی تاریخ ممکن نشد');
}

/* ------------------------------ محاسبه ------------------------------ */

export interface ScheduleRow {
  index: number;
  dueDate: string;
  amount: Decimal;
  /** مقداری از این قسط که تا امروز پرداخت شده (پرداخت‌ها به ترتیب روی اقساط می‌نشینند) */
  paidPart: Decimal;
  status: 'paid' | 'partial' | 'unpaid';
  overdue: boolean;
}

export interface PaymentRow {
  id: string;
  date: string;
  amount: Decimal;
  /** مانده‌ی بدهی پس از این پرداخت */
  remainingAfter: Decimal;
  fromCash: boolean;
  note?: string;
}

export interface DebtState {
  debt: Debt;
  total: Decimal;
  paid: Decimal;
  remaining: Decimal;
  settled: boolean;
  payments: PaymentRow[];
  schedule: ScheduleRow[];
  nextDue: ScheduleRow | null;
  overdueCount: number;
}

function paymentsOf(debtId: string, payments: DebtPayment[]): DebtPayment[] {
  // ترتیب: تاریخ، سپس ترتیب ثبت در آرایه
  return live(payments)
    .map((p, i) => ({ p, i }))
    .filter((x) => x.p.debtId === debtId)
    .sort((a, b) => (a.p.date < b.p.date ? -1 : a.p.date > b.p.date ? 1 : a.i - b.i))
    .map((x) => x.p);
}

export function buildSchedule(debt: Debt, paid: Decimal, todayIso: string): ScheduleRow[] {
  const plan = debt.plan;
  const total = parseDec(debt.amount);
  const inst = plan ? parseDec(plan.installment) : null;
  if (!plan || !total || !inst || plan.count < 1) return [];
  const rows: ScheduleRow[] = [];
  let before = ZERO;
  for (let i = 0; i < plan.count; i++) {
    const last = i === plan.count - 1;
    let amount = last ? total.minus(inst.mul(plan.count - 1)) : inst;
    if (amount.isNegative()) amount = ZERO;
    let paidPart = paid.minus(before);
    if (paidPart.isNegative()) paidPart = ZERO;
    if (paidPart.gt(amount)) paidPart = amount;
    const status: ScheduleRow['status'] = paidPart.gte(amount) ? 'paid' : paidPart.isZero() ? 'unpaid' : 'partial';
    const dueDate = addJalaliMonths(plan.firstDate, i * plan.everyMonths);
    rows.push({ index: i + 1, dueDate, amount, paidPart, status, overdue: status !== 'paid' && dueDate < todayIso });
    before = before.plus(amount);
  }
  return rows;
}

export function computeDebt(debt: Debt, payments: DebtPayment[], todayIso: string): DebtState {
  const total = parseDec(debt.amount) ?? ZERO;
  let paid = ZERO;
  const rows: PaymentRow[] = [];
  for (const p of paymentsOf(debt.id, payments)) {
    const a = parseDec(p.amount);
    if (!a || a.lte(0)) continue;
    paid = paid.plus(a);
    rows.push({ id: p.id, date: p.date, amount: a, remainingAfter: total.minus(paid), fromCash: !!p.fromCash, note: p.note });
  }
  const remaining = total.minus(paid);
  const schedule = buildSchedule(debt, paid, todayIso);
  const nextDue = schedule.find((r) => r.status !== 'paid') ?? null;
  return {
    debt, total, paid, remaining,
    settled: remaining.lte(0) && total.gt(0),
    payments: rows, schedule, nextDue,
    overdueCount: schedule.filter((r) => r.overdue).length,
  };
}

export interface PersonState {
  person: Person;
  debts: DebtState[];
  /** مانده‌ی طلب من از او (او بدهکار است) */
  receivable: Decimal;
  /** مانده‌ی بدهی من به او */
  payable: Decimal;
  /** طلب − بدهی؛ مثبت = او به من بدهکار است */
  net: Decimal;
  overdueCount: number;
}

export function computePerson(person: Person, data: PeopleData, todayIso: string): PersonState {
  const debts = live(data.debts)
    .filter((d) => d.personId === person.id)
    .map((d) => computeDebt(d, data.payments, todayIso));
  let receivable = ZERO;
  let payable = ZERO;
  for (const d of debts) {
    if (d.remaining.lte(0)) continue;
    if (d.debt.direction === 'lent') receivable = receivable.plus(d.remaining);
    else payable = payable.plus(d.remaining);
  }
  return {
    person, debts, receivable, payable, net: receivable.minus(payable),
    overdueCount: debts.reduce((s, d) => s + d.overdueCount, 0),
  };
}

export interface PeopleSummary {
  persons: PersonState[];
  receivable: Decimal;
  payable: Decimal;
}

export function computePeople(data: PeopleData, todayIso: string): PeopleSummary {
  const persons = live(data.people).map((p) => computePerson(p, data, todayIso));
  return {
    persons,
    receivable: persons.reduce((s, p) => s.plus(p.receivable), ZERO),
    payable: persons.reduce((s, p) => s.plus(p.payable), ZERO),
  };
}

/**
 * اثر وام‌ها و پرداخت‌ها روی وجه نقد (فقط مواردی که «fromCash» دارند).
 * گرفتن وام (+)، دادن وام (−)، پرداخت من (−)، دریافت از او (+).
 */
export function cashEffect(data: PeopleData): Decimal {
  const dir = new Map(live(data.debts).map((d) => [d.id, d.direction]));
  let delta = ZERO;
  for (const d of live(data.debts)) {
    if (!d.fromCash) continue;
    const a = parseDec(d.amount) ?? ZERO;
    delta = d.direction === 'borrowed' ? delta.plus(a) : delta.minus(a);
  }
  for (const p of live(data.payments)) {
    if (!p.fromCash) continue;
    const direction = dir.get(p.debtId);
    if (!direction) continue;
    const a = parseDec(p.amount) ?? ZERO;
    delta = direction === 'lent' ? delta.plus(a) : delta.minus(a);
  }
  return delta;
}

/** سرمایه‌ی خالص = نقد + ارزش دارایی‌ها + طلب‌ها − بدهی‌ها */
export function netWorth(cash: Decimal, assetsValue: Decimal, people: PeopleSummary): Decimal {
  return cash.plus(assetsValue).plus(people.receivable).minus(people.payable);
}

/* ---------------------------- اعتبارسنجی ---------------------------- */

export function validatePeople(data: PeopleData): PeopleIssue[] {
  const issues: PeopleIssue[] = [];
  const persons = new Set(live(data.people).map((p) => p.id));
  const debtsById = new Map(live(data.debts).map((d) => [d.id, d]));

  for (const d of live(data.debts)) {
    const bad = (code: PeopleIssue['code'], message: string) => issues.push({ code, id: d.id, message });
    if (!persons.has(d.personId)) bad('NO_PERSON', 'شخص این وام پیدا نشد.');
    const a = parseDec(d.amount);
    if (!a || a.lte(0) || !a.isInteger()) bad('BAD_FIELD', 'مبلغ وام باید عدد صحیح و بیشتر از صفر (ریال) باشد.');
    if (!DATE_RE.test(d.date)) bad('BAD_FIELD', 'تاریخ وام معتبر نیست.');
    if (d.plan) {
      const inst = parseDec(d.plan.installment);
      if (!Number.isInteger(d.plan.count) || d.plan.count < 1 || d.plan.count > 600) bad('BAD_PLAN', 'تعداد اقساط معتبر نیست.');
      else if (!inst || inst.lte(0) || !inst.isInteger()) bad('BAD_PLAN', 'مبلغ هر قسط معتبر نیست.');
      else if (!DATE_RE.test(d.plan.firstDate) || !Number.isInteger(d.plan.everyMonths) || d.plan.everyMonths < 1) bad('BAD_PLAN', 'تاریخ یا فاصله‌ی اقساط معتبر نیست.');
      else if (a && a.gt(0) && a.minus(inst.mul(d.plan.count - 1)).lte(0)) {
        bad('BAD_PLAN', 'جمع اقساط بیشتر از مبلغ وام می‌شود. تعداد یا مبلغ قسط را کمتر کنید.');
      }
    }
  }

  for (const d of debtsById.values()) {
    const total = parseDec(d.amount) ?? ZERO;
    let paid = ZERO;
    for (const p of paymentsOf(d.id, data.payments)) {
      const a = parseDec(p.amount);
      if (!a || a.lte(0) || !a.isInteger() || !DATE_RE.test(p.date)) {
        issues.push({ code: 'BAD_FIELD', id: p.id, message: 'مبلغ پرداخت باید عدد صحیح بیشتر از صفر و تاریخ معتبر باشد.' });
        continue;
      }
      if (p.date < d.date) issues.push({ code: 'BEFORE_START', id: p.id, message: 'تاریخ پرداخت قبل از تاریخ وام است.' });
      paid = paid.plus(a);
      if (paid.gt(total)) {
        issues.push({ code: 'OVERPAY', id: p.id, message: 'مجموع پرداخت‌ها از مبلغ وام بیشتر می‌شود.' });
      }
    }
  }
  for (const p of live(data.payments)) {
    if (!debtsById.has(p.debtId)) issues.push({ code: 'NO_PERSON', id: p.id, message: 'وام این پرداخت پیدا نشد.' });
  }
  return issues;
}

/**
 * ماشین‌حساب وام و قسط.
 *  - کاهشی (annuity): قسط ثابت؛ سود هر ماه روی مانده‌ی بدهی حساب می‌شود.
 *  - ثابت (flat): سود کل = اصل × نرخ سالانه × (ماه‌ها ÷ ۱۲) ‏، به‌طور مساوی در قسط‌ها پخش می‌شود
 *    (روش رایج وام‌های بانکی ایران).
 * مبالغ ریال و دقیق (Decimal)؛ هر قسط به ریال گرد می‌شود و قسط آخر باقی‌مانده را صفر می‌کند.
 */
import { Decimal } from './decimal';
import { addJalaliMonths } from './people';

export type LoanMethod = 'annuity' | 'flat';
export const MAX_MONTHS = 480;

export interface LoanRow { index: number; date: string | null; payment: Decimal; interest: Decimal; principal: Decimal; balance: Decimal }
export interface LoanResult {
  method: LoanMethod;
  payment: Decimal;        // قسط عادی
  totalPaid: Decimal;
  totalInterest: Decimal;
  rows: LoanRow[];
}

export function validateLoan(principal: Decimal, annualPct: Decimal, months: number): string | null {
  if (!principal.gt(0)) return 'مبلغ وام باید بیشتر از صفر باشد.';
  if (annualPct.isNegative() || annualPct.gt(1000)) return 'نرخ سود سالانه معتبر نیست.';
  if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) return `تعداد قسط باید بین ۱ و ${MAX_MONTHS} باشد.`;
  return null;
}

export function computeLoan(
  principal: Decimal, annualPct: Decimal, months: number, method: LoanMethod, firstDate?: string,
): LoanResult | null {
  if (validateLoan(principal, annualPct, months)) return null;
  const rows: LoanRow[] = [];
  const dateOf = (k: number) => (firstDate ? addJalaliMonths(firstDate, k) : null);
  let balance = principal;
  let payment: Decimal;

  if (method === 'flat') {
    const totalInterest = principal.mul(annualPct).div(100).mul(months).div(12);
    payment = principal.plus(totalInterest).div(months).round(0);
    // سود هر قسط طوری گرد می‌شود که مجموعش دقیقاً برابر سود کل (گردشده) باشد
    const cum = (k: number) => totalInterest.mul(k).div(months).round(0);
    for (let k = 0; k < months; k++) {
      const last = k === months - 1;
      const interest = cum(k + 1).minus(cum(k));
      const pay = last ? balance.plus(interest) : payment;
      const princ = last ? balance : pay.minus(interest);
      balance = balance.minus(princ);
      rows.push({ index: k + 1, date: dateOf(k), payment: pay, interest, principal: princ, balance });
    }
  } else {
    const i = annualPct.div(100).div(12);
    if (i.isZero()) {
      payment = principal.div(months).round(0);
    } else {
      // قسط = اصل × i ÷ (۱ − (۱+i)^−n)
      const growth = powDec(Decimal.ONE.plus(i), months);
      payment = principal.mul(i).mul(growth).div(growth.minus(1)).round(0);
    }
    for (let k = 0; k < months; k++) {
      const last = k === months - 1;
      const interest = balance.mul(i).round(0);
      const princ = last ? balance : payment.minus(interest);
      const pay = last ? balance.plus(interest) : payment;
      balance = balance.minus(princ);
      rows.push({ index: k + 1, date: dateOf(k), payment: pay, interest, principal: princ, balance });
    }
  }
  const totalPaid = rows.reduce((s, r) => s.plus(r.payment), Decimal.ZERO);
  return { method, payment, totalPaid, totalInterest: totalPaid.minus(principal), rows };
}

function powDec(base: Decimal, n: number): Decimal {
  let result = Decimal.ONE;
  let b = base;
  let e = n;
  while (e > 0) {
    if (e & 1) result = result.mul(b);
    b = b.mul(b);
    e >>= 1;
  }
  return result;
}

/**
 * نرخ سالانه‌ی مؤثر (کاهشی) وقتی اصل، قسط و تعداد را می‌دانید؛ تقریبی با ممیز شناور.
 * اگر مجموع اقساط از اصل کمتر باشد یا حل نشود null.
 */
export function impliedAnnualRate(principal: number, payment: number, months: number): number | null {
  if (!(principal > 0) || !(payment > 0) || !Number.isInteger(months) || months < 1) return null;
  if (payment * months < principal) return null;
  if (Math.abs(payment * months - principal) < 1e-9 * principal) return 0;
  const f = (i: number) => (i === 0 ? principal / months : (principal * i) / (1 - Math.pow(1 + i, -months))) - payment;
  let lo = 0, hi = 1; // ماهانه تا ۱۰۰٪
  if (f(hi) < 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid; else lo = mid;
  }
  return ((lo + hi) / 2) * 12 * 100;
}

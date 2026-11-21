/**
 * گزارش ماهانه و خروجی CSV (قابل‌باز شدن در Excel).
 * هسته‌ی خالص: ورودی‌ها داده‌اند و خروجی‌ها متن/عدد؛ هیچ وابستگی به رابط ندارد.
 */
import { Decimal } from './decimal';
import { activeTx, computeAssetState, parseDec, sortTx } from './engine';
import { INCOME_LABEL, incomeTotals, IncomeTotals } from './income';
import { addDaysIso } from './reminders';
import { JALALI_MONTHS, isoToJalali, jalaliToIso } from './jalali';
import { Asset, CASH_ID, Tx } from './types';

/** اول و آخر ماه شمسی به‌صورت تاریخ میلادی؛ ماه نامعتبر ⇒ null */
export function monthRange(jy: number, jm: number): { from: string; to: string } | null {
  const from = jalaliToIso(jy, jm, 1);
  if (!from) return null;
  const nextY = jm === 12 ? jy + 1 : jy;
  const nextM = jm === 12 ? 1 : jm + 1;
  const next = jalaliToIso(nextY, nextM, 1);
  if (!next) return null;
  return { from, to: addDaysIso(next, -1) };
}

export function monthTitle(jy: number, jm: number): string {
  return `${JALALI_MONTHS[jm - 1]} ${jy}`;
}

export function shiftMonth(jy: number, jm: number, delta: number): { y: number; m: number } {
  const idx = jy * 12 + (jm - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

export interface MonthReport {
  from: string; to: string;
  txCount: number;
  bought: Decimal;     // مجموع خرید (با کارمزد)
  sold: Decimal;       // مجموع فروش (خالص پس از کارمزد)
  fees: Decimal;
  realized: Decimal;   // سود/زیان فروش‌های ماه
  income: IncomeTotals;
  cashIn: Decimal;     // واریز عادی (غیر درآمد)
  cashOut: Decimal;
  /** ارزش سرمایه در اولین و آخرین نقطه‌ی تاریخچه‌ی ماه (در صورت وجود) */
  worthStart: Decimal | null;
  worthEnd: Decimal | null;
}

export function monthReport(
  assets: Asset[], txs: Tx[], from: string, to: string, history: { at: string; value: string }[] = [],
): MonthReport {
  const inRange = (d: string) => d >= from && d <= to;
  let bought = Decimal.ZERO, sold = Decimal.ZERO, fees = Decimal.ZERO, realized = Decimal.ZERO;
  let count = 0;
  for (const a of assets) {
    if (a.id === CASH_ID) continue;
    for (const r of computeAssetState(a.id, txs).rows) {
      if (!inRange(r.date)) continue;
      count++;
      fees = fees.plus(r.fee);
      if (r.type === 'buy') bought = bought.plus(r.total);
      else if (r.type === 'sell') { sold = sold.plus(r.total); if (r.realizedPnl) realized = realized.plus(r.realizedPnl); }
    }
  }
  let cashIn = Decimal.ZERO, cashOut = Decimal.ZERO;
  for (const t of activeTx(txs)) {
    if (t.assetId !== CASH_ID || !inRange(t.date)) continue;
    count++;
    const q = parseDec(t.quantity);
    if (!q) continue;
    if (t.type === 'deposit' && !t.income) cashIn = cashIn.plus(q);
    else if (t.type === 'withdraw') cashOut = cashOut.plus(q);
  }
  const pts = history
    .filter((h) => h.at.slice(0, 10) >= from && h.at.slice(0, 10) <= to && parseDec(h.value))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  return {
    from, to, txCount: count, bought, sold, fees, realized,
    income: incomeTotals(txs, from, to), cashIn, cashOut,
    worthStart: pts.length ? parseDec(pts[0].value) : null,
    worthEnd: pts.length ? parseDec(pts[pts.length - 1].value) : null,
  };
}

/* ------------------------------ CSV ------------------------------ */

/**
 * یک خانه‌ی CSV. متن‌هایی که با = + - @ یا tab شروع شوند در Excel فرمول می‌شوند؛
 * با یک ' در ابتدا بی‌اثر می‌شوند (جلوگیری از تزریق فرمول از یادداشت‌ها و نام‌ها).
 */
export function csvCell(v: string | number | null | undefined, isText = true): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const BOM = '﻿';
const TYPE_FA: Record<string, string> = { buy: 'خرید', sell: 'فروش', receive: 'دریافت', deposit: 'واریز', withdraw: 'برداشت' };

function jalaliText(iso: string): string {
  const j = isoToJalali(iso);
  return j ? `${j.y}/${String(j.m).padStart(2, '0')}/${String(j.d).padStart(2, '0')}` : iso;
}

/** همه‌ی تراکنش‌های بازه (یا همه) با مبالغ ریالی و ارقام انگلیسی تا Excel عدد بشناسد */
export function txCsv(assets: Asset[], txs: Tx[], from?: string, to?: string): string {
  const name = new Map(assets.map((a) => [a.id, a.name]));
  const head = ['تاریخ شمسی', 'تاریخ میلادی', 'دارایی', 'نوع', 'نوع سود', 'مقدار', 'قیمت واحد (ریال)', 'کارمزد (ریال)', 'مبلغ کل (ریال)', 'منبع', 'یادداشت'];
  const rows = activeTx(txs)
    .filter((t) => (!from || t.date >= from) && (!to || t.date <= to))
    .sort(sortTx)
    .map((t) => {
      const q = parseDec(t.quantity) ?? Decimal.ZERO;
      const p = parseDec(t.unitPrice) ?? Decimal.ZERO;
      const fee = parseDec(t.fee) ?? Decimal.ZERO;
      const gross = q.mul(p);
      const total = t.type === 'buy' ? gross.plus(fee) : t.type === 'sell' ? gross.minus(fee) : gross;
      return [
        csvCell(jalaliText(t.date), false), csvCell(t.date, false),
        csvCell(t.assetId === CASH_ID ? 'نقد' : name.get(t.assetId) ?? t.assetId),
        csvCell(TYPE_FA[t.type] ?? t.type), csvCell(t.income ? INCOME_LABEL[t.income] : ''),
        csvCell(q.toString(), false), csvCell(p.toString(), false), csvCell(fee.toString(), false), csvCell(total.toString(), false),
        csvCell(t.source ?? ''), csvCell(t.note ?? ''),
      ].join(',');
    });
  return BOM + [head.map((h) => csvCell(h)).join(','), ...rows].join('\r\n') + '\r\n';
}

/** خلاصه‌ی ماه به‌صورت CSV دو ستونی */
export function reportCsv(title: string, r: MonthReport): string {
  const line = (k: string, v: string) => `${csvCell(k)},${csvCell(v, false)}`;
  const lines = [
    line('گزارش', title), line('از', jalaliText(r.from)), line('تا', jalaliText(r.to)),
    line('تعداد معاملات', String(r.txCount)),
    line('مجموع خرید (ریال)', r.bought.toString()), line('مجموع فروش (ریال)', r.sold.toString()),
    line('کارمزدها (ریال)', r.fees.toString()), line('سود یا زیان فروش‌ها (ریال)', r.realized.toString()),
    line('سود سهام (ریال)', r.income.dividend.toString()), line('سود سپرده (ریال)', r.income.deposit.toString()),
    line('سود روزشمار (ریال)', r.income.accrual.toString()),
    line('واریز نقد (ریال)', r.cashIn.toString()), line('برداشت نقد (ریال)', r.cashOut.toString()),
  ];
  return BOM + lines.join('\r\n') + '\r\n';
}

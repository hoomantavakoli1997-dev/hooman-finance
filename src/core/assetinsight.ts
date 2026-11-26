/**
 * مقایسه‌ی هر دارایی با جایگزین‌ها: «اگر همان پول (به تاریخ هر خرید) در بانک می‌ماند» و
 * «اگر باید با تورم همان دارایی هم‌پا می‌شد». نرخ بانک و تورم را کاربر وارد می‌کند و برنامه حدس نمی‌زند.
 * مبنا موجودی فعلی است (سهم باقی‌مانده‌ی هر خرید، مثل سود واقعی کل).
 * سود مرکب سالانه‌ی تقریبی است: بانک‌ها معمولاً سود را ماهانه یا سررسید می‌پردازند.
 */
import { Decimal } from './decimal';
import { Tx } from './types';
import { daysBetween } from './reminders';
import { heldLots, PriceLog } from './realreturn';
import { parseDec } from './engine';

export interface Opportunity {
  qty: Decimal;
  cost: Decimal;
  value: Decimal;
  avgCost: Decimal;
  /** میانگین مدت نگهداری (روز) با وزن مبلغ هر خرید */
  avgDays: number;
  /** سود اسمی: ارزش فعلی نسبت به بهای خرید (۰٫۲ = ۲۰٪) */
  nominal: Decimal;
  /** ارزش امروز همان بهای خرید اگر در بانک بود */
  bankValue: Decimal | null;
  /** ارزش دارایی نسبت به بانک: ۰٫۱ یعنی ۱۰٪ بهتر از بانک */
  vsBank: Decimal | null;
  /** ارزشی که دارایی باید می‌داشت تا فقط با تورم هم‌پا شود */
  inflValue: Decimal | null;
  /** سود واقعی نسبت به تورم */
  real: Decimal | null;
}

const okRate = (r: number | null): r is number => r !== null && Number.isFinite(r) && r >= 0;
const factor = (pct: number, days: number) => Decimal.of(Math.pow(1 + pct / 100, Math.max(0, days) / 365).toFixed(8));

export function assetOpportunity(
  assetId: string, txs: Tx[], now: Decimal | null, today: string, bankPct: number | null, inflPct: number | null,
): Opportunity | null {
  if (!now || !now.gt(0)) return null;
  const lots = heldLots(assetId, txs).filter((l) => l.cost.gt(0) && l.qty.gt(0));
  if (!lots.length) return null;
  let qty = Decimal.ZERO, cost = Decimal.ZERO, bank = Decimal.ZERO, infl = Decimal.ZERO, dayCost = 0;
  for (const l of lots) {
    const days = Math.max(0, daysBetween(l.date, today));
    qty = qty.plus(l.qty); cost = cost.plus(l.cost);
    dayCost += days * l.cost.toNumber();
    if (okRate(bankPct)) bank = bank.plus(l.cost.mul(factor(bankPct, days)));
    if (okRate(inflPct)) infl = infl.plus(l.cost.mul(factor(inflPct, days)));
  }
  const value = qty.mul(now);
  const nominal = value.div(cost).minus(1);
  const hasBank = okRate(bankPct), hasInfl = okRate(inflPct);
  return {
    qty, cost, value, avgCost: cost.div(qty),
    avgDays: Math.round(dayCost / cost.toNumber()),
    nominal,
    bankValue: hasBank ? bank : null,
    vsBank: hasBank ? value.div(bank).minus(1) : null,
    inflValue: hasInfl ? infl : null,
    real: hasInfl ? value.div(infl).minus(1) : null,
  };
}

export interface SeriesPoint { date: string; price: Decimal }

/** قیمت‌های واقعاً ثبت‌شده‌ی خودکار یک دارایی به ترتیب تاریخ (هیچ نقطه‌ای ساخته نمی‌شود) */
export function priceSeries(assetId: string, log: PriceLog): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const [date, day] of Object.entries(log)) {
    const p = day[assetId] ? parseDec(day[assetId]) : null;
    if (p && p.gt(0)) out.push({ date, price: p });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

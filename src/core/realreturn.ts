/**
 * سود واقعی: بازده اسمی دارایی‌های فعلی در مقایسه با اینکه همان پول در دلار، طلا یا (با نرخ تورم
 * واردشده‌ی کاربر) نگه داشته می‌شد.
 *
 * اصول:
 *  - قیمت تاریخی جعل نمی‌شود: فقط از قیمت‌های واقعاً ثبت‌شده (گزارش قیمت روزانه‌ی خود برنامه و
 *    معاملات خود کاربر) استفاده می‌شود و اگر قیمت مرجع نزدیک تاریخ خرید نباشد، آن خرید در آن
 *    مقایسه نمی‌آید و «پوشش» گزارش می‌شود.
 *  - مبنا موجودی فعلی است؛ با همان روش میانگین موزون موتور محاسبات، سهم باقی‌مانده‌ی هر خرید حساب می‌شود.
 *  - تورم تخمینی است (نرخ سالانه را کاربر می‌دهد) و با ممیز شناور محاسبه می‌شود.
 */
import { Decimal } from './decimal';
import { activeTx, parseDec, sortTx } from './engine';
import { CASH_ID, PriceEntry, Tx } from './types';
import { daysBetween, isIso } from './reminders';

/** تاریخ → { شناسه‌ی دارایی → قیمت ریالی }؛ از قیمت‌های خودکار روزانه ساخته می‌شود */
export type PriceLog = Record<string, Record<string, string>>;

export const USD_ID = 'usd';
export const GOLD_ID = 'gold';
/** حداکثر فاصله‌ی روزی قیمت مرجع تا تاریخ خرید */
export const MAX_REF_GAP_DAYS = 30;
/** نگه‌داشتن گزارش قیمت: حداکثر تعداد روز */
export const PRICE_LOG_DAYS = 800;

/** قیمت خودکار را زیر تاریخ خود قیمت (نه تاریخ امروز) ثبت می‌کند؛ قیمت دستی مرجع معتبر نیست */
export function logPrices(log: PriceLog, ids: string[], prices: Record<string, PriceEntry>): boolean {
  let changed = false;
  for (const id of ids) {
    const e = prices[id];
    if (!e || e.source !== 'auto') continue;
    const p = parseDec(e.price);
    const date = typeof e.at === 'string' ? e.at.slice(0, 10) : '';
    if (!p || !p.gt(0) || !isIso(date)) continue;
    const day = (log[date] ??= {});
    if (day[id] !== e.price) { day[id] = e.price; changed = true; }
  }
  const keys = Object.keys(log).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - PRICE_LOG_DAYS))) { delete log[k]; changed = true; }
  return changed;
}

interface Pt { date: string; price: Decimal }

export function refPoints(assetId: string, txs: Tx[], log: PriceLog): Pt[] {
  const out: Pt[] = [];
  for (const [date, day] of Object.entries(log)) {
    const p = day[assetId] ? parseDec(day[assetId]) : null;
    if (p && p.gt(0)) out.push({ date, price: p });
  }
  for (const t of activeTx(txs)) {
    if (t.assetId !== assetId || t.type === 'deposit' || t.type === 'withdraw') continue;
    const p = parseDec(t.unitPrice);
    if (p && p.gt(0)) out.push({ date: t.date, price: p });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** نزدیک‌ترین قیمت ثبت‌شده به تاریخ (تا `maxGap` روز)؛ وگرنه null */
export function priceNear(points: Pt[], date: string, maxGap = MAX_REF_GAP_DAYS): Decimal | null {
  let best: Pt | null = null;
  let bestGap = Infinity;
  for (const p of points) {
    const g = Math.abs(daysBetween(p.date, date));
    if (g < bestGap) { best = p; bestGap = g; }
  }
  return best && bestGap <= maxGap ? best.price : null;
}

export interface HeldLot { date: string; qty: Decimal; cost: Decimal }

/** سهم باقی‌مانده‌ی هر خرید پس از فروش‌ها؛ مجموع هزینه‌ها برابر بهای تمام‌شده‌ی موتور است */
export function heldLots(assetId: string, txs: Tx[]): HeldLot[] {
  const lots: HeldLot[] = [];
  let quantity = Decimal.ZERO;
  for (const tx of activeTx(txs).filter((t) => t.assetId === assetId).sort(sortTx)) {
    const q = parseDec(tx.quantity);
    const p = parseDec(tx.unitPrice);
    const fee = parseDec(tx.fee) ?? Decimal.ZERO;
    if (!q || !p || q.lte(0)) continue;
    if (tx.type === 'buy' || tx.type === 'receive') {
      const cost = q.mul(p).plus(tx.type === 'buy' ? fee : Decimal.ZERO);
      lots.push({ date: tx.date, qty: q, cost });
      quantity = quantity.plus(q);
    } else if (tx.type === 'sell') {
      if (q.gt(quantity)) continue; // فروش نامعتبر در موتور هم اعمال نمی‌شود
      if (q.eq(quantity)) { lots.length = 0; quantity = Decimal.ZERO; continue; }
      const keep = Decimal.ONE.minus(q.div(quantity));
      for (const l of lots) { l.qty = l.qty.mul(keep); l.cost = l.cost.mul(keep); }
      quantity = quantity.minus(q);
    }
  }
  return lots;
}

export interface Bench {
  /** سود اسمی همان خریدهای پوشش‌داده‌شده (نسبت، مثلاً ۰٫۲ = ۲۰٪) */
  nominal: Decimal;
  /** سود نگه‌داشتن همان پول در مرجع */
  bench: Decimal;
  /** سود واقعی نسبت به مرجع: (۱+اسمی)/(۱+مرجع) − ۱ */
  real: Decimal;
  /** سهم هزینه‌ای که قیمت مرجع برایش پیدا شد (۰ تا ۱) */
  coverage: number;
}

export interface RealReturn {
  cost: Decimal;
  value: Decimal;
  nominal: Decimal;
  usd: Bench | null;
  gold: Bench | null;
  inflation: Bench | null;
  /** دارایی‌های دارای موجودی که قیمت روز ندارند و محاسبه نشدند */
  missingPrice: string[];
}

function bench(nominalNum: Decimal, benchNum: Decimal, cost: Decimal, covered: Decimal): Bench | null {
  if (covered.lte(0)) return null;
  const nominal = nominalNum.div(covered).minus(1);
  const b = benchNum.div(covered).minus(1);
  const real = Decimal.ONE.plus(nominal).div(Decimal.ONE.plus(b)).minus(1);
  return { nominal, bench: b, real, coverage: covered.div(cost).toNumber() };
}

export function computeRealReturn(
  assetIds: string[], txs: Tx[], prices: Record<string, PriceEntry>, log: PriceLog,
  today: string, inflationPct: number | null,
): RealReturn | null {
  const usdNow = priceDec(prices[USD_ID]);
  const goldNow = priceDec(prices[GOLD_ID]);
  const usdPts = refPoints(USD_ID, txs, log);
  const goldPts = refPoints(GOLD_ID, txs, log);

  let cost = Decimal.ZERO, value = Decimal.ZERO;
  const acc = {
    usd: { cov: Decimal.ZERO, nom: Decimal.ZERO, ben: Decimal.ZERO },
    gold: { cov: Decimal.ZERO, nom: Decimal.ZERO, ben: Decimal.ZERO },
    inf: { cov: Decimal.ZERO, nom: Decimal.ZERO, ben: Decimal.ZERO },
  };
  const missingPrice: string[] = [];

  for (const id of assetIds) {
    if (id === CASH_ID) continue;
    const lots = heldLots(id, txs);
    if (!lots.length) continue;
    const now = priceDec(prices[id]);
    if (!now) { missingPrice.push(id); continue; }
    for (const l of lots) {
      if (l.cost.lte(0)) continue; // هدیه‌ی بدون ارزش: مبنایی برای بازده ندارد
      const v = l.qty.mul(now);
      cost = cost.plus(l.cost); value = value.plus(v);
      const add = (a: { cov: Decimal; nom: Decimal; ben: Decimal }, ben: Decimal) => {
        a.cov = a.cov.plus(l.cost); a.nom = a.nom.plus(v); a.ben = a.ben.plus(ben);
      };
      if (usdNow) { const r = priceNear(usdPts, l.date); if (r) add(acc.usd, l.cost.mul(usdNow.div(r))); }
      if (goldNow) { const r = priceNear(goldPts, l.date); if (r) add(acc.gold, l.cost.mul(goldNow.div(r))); }
      if (inflationPct !== null && Number.isFinite(inflationPct) && inflationPct >= 0) {
        const days = Math.max(0, daysBetween(l.date, today));
        const f = Math.pow(1 + inflationPct / 100, days / 365);
        add(acc.inf, l.cost.mul(Decimal.of(f.toFixed(8))));
      }
    }
  }
  if (cost.lte(0)) return null;
  return {
    cost, value, nominal: value.div(cost).minus(1),
    usd: bench(acc.usd.nom, acc.usd.ben, cost, acc.usd.cov),
    gold: bench(acc.gold.nom, acc.gold.ben, cost, acc.gold.cov),
    inflation: bench(acc.inf.nom, acc.inf.ben, cost, acc.inf.cov),
    missingPrice,
  };
}

function priceDec(e: PriceEntry | undefined): Decimal | null {
  const p = e ? parseDec(e.price) : null;
  return p && p.gt(0) ? p : null;
}

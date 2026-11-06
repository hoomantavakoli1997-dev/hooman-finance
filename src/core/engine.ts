import { Decimal } from './decimal';
import { Asset, CASH_ID, PriceEntry, Tx, TxType, ValidationIssue } from './types';

const ZERO = Decimal.ZERO;

export function parseDec(v: string | undefined | null): Decimal | null {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  try {
    return Decimal.parse(String(v));
  } catch {
    return null;
  }
}

/** گرد کردن به ریال صحیح (فقط برای نمایش/خروجی؛ محاسبات داخلی دقیق می‌مانند) */
export function toRial(d: Decimal): number {
  return Number(d.roundToInt());
}

export function sortTx(a: Tx, b: Tx): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.seq - b.seq;
}

export function activeTx(txs: Tx[]): Tx[] {
  return txs.filter((t) => !t.deletedAt);
}

/* ------------------------------------------------------------------ */
/* اعتبارسنجی فیلدها                                                    */
/* ------------------------------------------------------------------ */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateFields(tx: Tx): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const bad = (message: string, code: ValidationIssue['code'] = 'BAD_FIELD') =>
    issues.push({ code, severity: 'error', txId: tx.id, assetId: tx.assetId, message });

  if (!DATE_RE.test(tx.date)) bad('تاریخ معتبر نیست.');

  const isCash = tx.assetId === CASH_ID;
  const cashTypes: TxType[] = ['deposit', 'withdraw'];
  const assetTypes: TxType[] = ['buy', 'sell', 'receive'];
  if (isCash && !cashTypes.includes(tx.type)) bad('برای وجه نقد فقط واریز یا برداشت مجاز است.', 'BAD_TYPE');
  if (!isCash && !assetTypes.includes(tx.type)) bad('برای دارایی فقط خرید، فروش یا دریافت مجاز است.', 'BAD_TYPE');

  const q = parseDec(tx.quantity);
  if (q === null || q.lte(0)) bad('مقدار باید بزرگ‌تر از صفر باشد.');

  const fee = parseDec(tx.fee);
  if (fee === null || fee.lt(0)) bad('کارمزد نمی‌تواند منفی باشد.');

  if (!isCash) {
    const p = parseDec(tx.unitPrice);
    if (p === null || p.lte(0)) bad('قیمت هر واحد باید بزرگ‌تر از صفر باشد.');
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* وضعیت هر دارایی (میانگین موزون)                                      */
/* ------------------------------------------------------------------ */

export interface HistoryRow {
  txId: string;
  type: TxType;
  date: string;
  quantity: Decimal;
  unitPrice: Decimal;
  fee: Decimal;
  /** مبلغ ناخالص = مقدار × قیمت */
  gross: Decimal;
  /** خرید: هزینه کل با کارمزد؛ فروش: دریافتی خالص پس از کارمزد */
  total: Decimal;
  quantityAfter: Decimal;
  costBasisAfter: Decimal;
  avgCostAfter: Decimal;
  /** فقط برای فروش */
  realizedPnl: Decimal | null;
}

export interface AssetState {
  quantity: Decimal;
  /** بهای تمام‌شده‌ی موجودی فعلی (شامل کارمزد خرید) */
  costBasis: Decimal;
  /** میانگین موزون قیمت خرید هر واحد */
  avgCost: Decimal;
  /** مجموع مبلغ خرید (مقدار × قیمت، بدون کارمزد) */
  totalBought: Decimal;
  totalSold: Decimal;
  totalFees: Decimal;
  realizedPnl: Decimal;
  rows: HistoryRow[];
  issues: ValidationIssue[];
}

export function computeAssetState(assetId: string, txs: Tx[]): AssetState {
  const list = activeTx(txs)
    .filter((t) => t.assetId === assetId)
    .sort(sortTx);

  let quantity = ZERO;
  let costBasis = ZERO;
  let totalBought = ZERO;
  let totalSold = ZERO;
  let totalFees = ZERO;
  let realized = ZERO;
  const rows: HistoryRow[] = [];
  const issues: ValidationIssue[] = [];

  for (const tx of list) {
    const q = parseDec(tx.quantity);
    const p = parseDec(tx.unitPrice);
    const fee = parseDec(tx.fee) ?? ZERO;
    if (q === null || p === null || q.lte(0)) continue; // خطای فیلد جداگانه گزارش می‌شود

    const gross = q.mul(p);

    if (tx.type === 'receive') {
      // هدیه/دریافتی: ارزش روز دریافت پایه‌ی هزینه می‌شود؛ از «مجموع خرید» جدا می‌ماند
      quantity = quantity.plus(q);
      costBasis = costBasis.plus(gross);
      rows.push({
        txId: tx.id, type: tx.type, date: tx.date, quantity: q, unitPrice: p, fee: ZERO, gross, total: gross,
        quantityAfter: quantity, costBasisAfter: costBasis,
        avgCostAfter: costBasis.div(quantity),
        realizedPnl: null,
      });
    } else if (tx.type === 'buy') {
      const total = gross.plus(fee);
      quantity = quantity.plus(q);
      costBasis = costBasis.plus(total);
      totalBought = totalBought.plus(gross);
      totalFees = totalFees.plus(fee);
      rows.push({
        txId: tx.id, type: tx.type, date: tx.date, quantity: q, unitPrice: p, fee, gross, total,
        quantityAfter: quantity, costBasisAfter: costBasis,
        avgCostAfter: quantity.isZero() ? ZERO : costBasis.div(quantity),
        realizedPnl: null,
      });
    } else if (tx.type === 'sell') {
      if (q.gt(quantity)) {
        issues.push({
          code: 'OVERSELL', severity: 'error', txId: tx.id, assetId,
          message: 'مقدار فروش بیشتر از موجودی در آن تاریخ است.',
        });
        continue; // معامله‌ی نامعتبر اعمال نمی‌شود
      }
      // اگر همه‌ی موجودی فروخته شود، بهای تمام‌شده دقیقاً حذف می‌شود (بدون باقی‌مانده‌ی گرد)
      const costRemoved = q.eq(quantity) ? costBasis : costBasis.mul(q).div(quantity);
      const total = gross.minus(fee);
      const pnl = total.minus(costRemoved);
      quantity = quantity.minus(q);
      costBasis = costBasis.minus(costRemoved);
      if (quantity.isZero()) costBasis = ZERO;
      totalSold = totalSold.plus(gross);
      totalFees = totalFees.plus(fee);
      realized = realized.plus(pnl);
      rows.push({
        txId: tx.id, type: tx.type, date: tx.date, quantity: q, unitPrice: p, fee, gross, total,
        quantityAfter: quantity, costBasisAfter: costBasis,
        avgCostAfter: quantity.isZero() ? ZERO : costBasis.div(quantity),
        realizedPnl: pnl,
      });
    }
  }

  return {
    quantity,
    costBasis,
    avgCost: quantity.isZero() ? ZERO : costBasis.div(quantity),
    totalBought, totalSold, totalFees,
    realizedPnl: realized,
    rows, issues,
  };
}

/* ------------------------------------------------------------------ */
/* وجه نقد                                                              */
/* ------------------------------------------------------------------ */

export interface CashState {
  balance: Decimal;
  issues: ValidationIssue[];
}

/**
 * موجودی نقد = واریزها − برداشت‌ها. فقط همین.
 * نقد و دارایی‌ها حساب‌های مستقل‌اند: خرید، فروش یا دریافت دارایی هرگز نقد را کم یا زیاد نمی‌کند
 * (حقوق و هدیه‌ی نقدی را «واریز» ثبت می‌کنید).
 */
export function computeCash(txs: Tx[]): CashState {
  const list = activeTx(txs).sort(sortTx);
  let balance = ZERO;
  const issues: ValidationIssue[] = [];

  for (const tx of list) {
    const q = parseDec(tx.quantity);
    const p = parseDec(tx.unitPrice) ?? Decimal.ONE;
    const fee = parseDec(tx.fee) ?? ZERO;
    if (q === null || q.lte(0)) continue;

    let delta = ZERO;
    if (tx.type === 'deposit') delta = q;
    else if (tx.type === 'withdraw') delta = q.neg();

    balance = balance.plus(delta);
    if (delta.isNegative() && balance.isNegative()) {
      issues.push({
        code: 'NEGATIVE_CASH', severity: 'warning', txId: tx.id, assetId: tx.assetId,
        message: 'موجودی وجه نقد برای این معامله کافی نیست. ابتدا واریز یا موجودی اولیه ثبت کنید.',
      });
    }
  }
  return { balance, issues };
}

/* ------------------------------------------------------------------ */
/* اعتبارسنجی کل دفتر + تغییرات (افزودن/ویرایش/حذف)                     */
/* ------------------------------------------------------------------ */

export function validateAll(txs: Tx[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const good: Tx[] = [];
  for (const tx of activeTx(txs)) {
    const f = validateFields(tx);
    issues.push(...f);
    if (f.length === 0) good.push(tx);
  }
  const ids = new Set(good.map((t) => t.assetId));
  ids.forEach((assetId) => {
    if (assetId !== CASH_ID) issues.push(...computeAssetState(assetId, good).issues);
  });
  issues.push(...computeCash(good).issues);
  return issues;
}

export const hasErrors = (issues: ValidationIssue[]) => issues.some((i) => i.severity === 'error');

export type ChangeResult =
  | { ok: true; txs: Tx[]; issues: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

function finish(next: Tx[]): ChangeResult {
  const issues = validateAll(next);
  return hasErrors(issues) ? { ok: false, issues } : { ok: true, txs: next, issues };
}

export type TxDraft = Omit<Tx, 'id' | 'seq' | 'deletedAt'>;

export function addTx(txs: Tx[], draft: TxDraft): ChangeResult {
  const seq = txs.reduce((m, t) => Math.max(m, t.seq), 0) + 1;
  return finish([...txs, { ...draft, id: `t${seq}`, seq, deletedAt: null }]);
}

export function updateTx(txs: Tx[], id: string, patch: Partial<TxDraft>): ChangeResult {
  if (!txs.some((t) => t.id === id)) {
    return { ok: false, issues: [{ code: 'BAD_FIELD', severity: 'error', txId: id, assetId: '', message: 'معامله پیدا نشد.' }] };
  }
  return finish(txs.map((t) => (t.id === id ? { ...t, ...patch } : t)));
}

/** حذف نرم؛ اگر حذف باعث موجودی منفی در تاریخ‌های بعد شود رد می‌شود */
export function deleteTx(txs: Tx[], id: string, nowIso: string): ChangeResult {
  return finish(txs.map((t) => (t.id === id ? { ...t, deletedAt: nowIso } : t)));
}

export function restoreTx(txs: Tx[], id: string): ChangeResult {
  return finish(txs.map((t) => (t.id === id ? { ...t, deletedAt: null } : t)));
}

/* ------------------------------------------------------------------ */
/* پورتفوی                                                              */
/* ------------------------------------------------------------------ */

export interface AssetSummary {
  asset: Asset;
  state: AssetState;
  price: PriceEntry | null;
  /** ارزش روز؛ اگر قیمت ثبت نشده باشد null (هیچ قیمت ساختگی نمایش داده نمی‌شود) */
  value: Decimal | null;
  unrealized: Decimal | null;
}

export interface Portfolio {
  cash: Decimal;
  assets: AssetSummary[];
  /** نقد + ارزش دارایی‌هایی که قیمت دارند */
  totalValue: Decimal;
  unrealizedTotal: Decimal;
  realizedTotal: Decimal;
  /** دارایی‌های دارای موجودی که قیمت روز ندارند؛ اگر خالی نباشد مجموع ناقص است */
  missingPrice: string[];
}

export function computePortfolio(
  assets: Asset[],
  txs: Tx[],
  prices: Record<string, PriceEntry>,
): Portfolio {
  const cash = computeCash(txs).balance;
  const summaries: AssetSummary[] = [];
  let totalValue = cash;
  let unrealizedTotal = ZERO;
  let realizedTotal = ZERO;
  const missingPrice: string[] = [];

  for (const asset of assets) {
    if (asset.id === CASH_ID) continue;
    const state = computeAssetState(asset.id, txs);
    const entry = prices[asset.id] ?? null;
    const price = entry ? parseDec(entry.price) : null;

    let value: Decimal | null = null;
    let unrealized: Decimal | null = null;
    if (state.quantity.isZero()) {
      value = ZERO;
      unrealized = ZERO;
    } else if (price !== null) {
      value = state.quantity.mul(price);
      unrealized = value.minus(state.costBasis);
    } else {
      missingPrice.push(asset.id);
    }

    if (value !== null) totalValue = totalValue.plus(value);
    if (unrealized !== null) unrealizedTotal = unrealizedTotal.plus(unrealized);
    realizedTotal = realizedTotal.plus(state.realizedPnl);
    summaries.push({ asset, state, price: entry, value, unrealized });
  }

  return { cash, assets: summaries, totalValue, unrealizedTotal, realizedTotal, missingPrice };
}

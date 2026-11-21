/**
 * هشدار قیمت وقتی برنامه بسته است: منطق خالص (بدون وابستگی به React Native).
 * اندروید اجرای پس‌زمینه را خودش زمان‌بندی می‌کند (حدود هر ۱۵ دقیقه یا کندتر، و در حالت صرفه‌جویی باتری ممکن است عقب بیفتد)،
 * پس این بررسی «تلاش بهتر» است و بررسی هنگام باز بودن برنامه جایگزینش نیست.
 */
import { Decimal } from '../core/decimal';
import { parseDec } from '../core/engine';
import { Quote } from '../core/prices';
import { fmtNum } from '../../web/format';

export interface BgAlert {
  id: string;
  assetName: string;
  side: 'buy' | 'sell';
  cond: 'above' | 'below';
  /** ریال به ازای هر واحد */
  target: string;
  provider: 'tgju' | 'tsetmc';
  key: string;
}

export interface BgConfig {
  alerts: BgAlert[];
  unit: 'toman' | 'rial';
  /** هشدارهایی که پس‌زمینه فعال کرده و هنوز به برنامه گزارش نشده */
  fired: string[];
}

export const EMPTY_BG: BgConfig = { alerts: [], unit: 'toman', fired: [] };
/** قیمت قدیمی‌تر از این هرگز هشدار نمی‌دهد (هم‌راستا با بررسی داخل برنامه) */
export const MAX_QUOTE_AGE_MS = 3 * 86_400_000;

export function sanitizeBg(raw: unknown): BgConfig | null {
  const c = raw as Partial<BgConfig> | null;
  if (!c || typeof c !== 'object') return null;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  const alerts: BgAlert[] = [];
  for (const a of Array.isArray(c.alerts) ? c.alerts.slice(0, 40) : []) {
    const x = a as Partial<BgAlert>;
    const target = parseDec(str(x?.target, 30));
    if (!x || !target || !target.gt(0)) continue;
    if (x.provider !== 'tgju' && x.provider !== 'tsetmc') continue;
    if (x.cond !== 'above' && x.cond !== 'below') continue;
    const key = str(x.key, 40);
    const id = str(x.id, 60);
    if (!key || !id) continue;
    alerts.push({ id, assetName: str(x.assetName, 60), side: x.side === 'sell' ? 'sell' : 'buy', cond: x.cond, target: target.toString(), provider: x.provider, key });
  }
  const fired = Array.isArray(c.fired) ? c.fired.filter((f): f is string => typeof f === 'string').slice(0, 100) : [];
  return { alerts, unit: c.unit === 'rial' ? 'rial' : 'toman', fired };
}

export interface BgHit { alert: BgAlert; price: Decimal }

/** quotes: کلید «provider:key» ← قیمت. قیمت قدیمی، صفر یا هدف نامعتبر هرگز هشدار نمی‌دهد. */
export function evaluateAlerts(alerts: BgAlert[], quotes: Map<string, Quote>, nowMs: number): BgHit[] {
  const hits: BgHit[] = [];
  for (const a of alerts) {
    const q = quotes.get(`${a.provider}:${a.key}`);
    if (!q || !q.price.gt(0)) continue;
    if (!Number.isFinite(q.atMs) || nowMs - q.atMs > MAX_QUOTE_AGE_MS) continue;
    const t = parseDec(a.target);
    if (!t) continue;
    if (a.cond === 'above' ? q.price.gte(t) : q.price.lte(t)) hits.push({ alert: a, price: q.price });
  }
  return hits;
}

export function hitText(h: BgHit, unit: 'toman' | 'rial'): { title: string; body: string } {
  const f = (d: Decimal) => `${fmtNum(unit === 'toman' ? d.div(10) : d)} ${unit === 'toman' ? 'تومان' : 'ریال'}`;
  return {
    title: `${h.alert.side === 'sell' ? 'وقت فروش' : 'وقت خرید'}: ${h.alert.assetName}`,
    body: `قیمت به ${f(h.price)} رسید. هدف شما: ${f(Decimal.of(h.alert.target))}`,
  };
}

/** اعلام‌شده‌ها از فهرست هشدارها حذف می‌شوند تا دوباره اعلان نیاید */
export function dropFired(alerts: BgAlert[], fired: string[]): BgAlert[] {
  const set = new Set(fired);
  return alerts.filter((a) => !set.has(a.id));
}

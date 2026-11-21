/**
 * داده‌ی ویجت صفحه‌ی اصلی: ردیف‌های قیمت از نمای بازار (TGJU). فقط منطق خالص؛ بدون وابستگی به React Native.
 * هیچ قیمتی ساخته نمی‌شود: اگر کلیدی در پاسخ نباشد ردیف ندارد و زمان داده همراه نمایش داده می‌شود.
 */
import { Decimal } from '../core/decimal';
import { MarketEntry, classify } from '../core/market';
import { fmtNum, toFa } from '../../web/format';

export interface WidgetRow { label: string; price: string; change: string; dir: 'up' | 'down' | '' }

export interface WidgetConfig {
  /** کلیدهای منتخب نمای بازار به ترتیب نمایش */
  keys: string[];
  unit: 'toman' | 'rial';
  /** کاربر نمایش سرمایه‌ی خالص را روشن کرده است (پیش‌فرض خاموش) */
  showWorth: boolean;
  worth: string | null;
  rows: WidgetRow[];
  /** زمان داده‌ی قیمت‌ها (ISO) */
  updatedAt: string | null;
}

export const EMPTY_WIDGET: WidgetConfig = { keys: [], unit: 'toman', showWorth: false, worth: null, rows: [], updatedAt: null };
export const MAX_WIDGET_ROWS = 6;

export function priceText(e: MarketEntry, unit: 'toman' | 'rial'): string {
  const meta = classify(e.key);
  let d: Decimal;
  try { d = Decimal.parse(e.price); } catch { return '—'; }
  if (meta.unit === 'irr') return `${fmtNum(unit === 'toman' ? d.div(10) : d)} ${unit === 'toman' ? 'تومان' : 'ریال'}`;
  if (meta.unit === 'usd') return `${fmtNum(d, 4)} دلار`;
  return fmtNum(d, 4);
}

export function buildRows(entries: MarketEntry[], keys: string[], unit: 'toman' | 'rial'): WidgetRow[] {
  const by = new Map(entries.map((e) => [e.key, e]));
  const out: WidgetRow[] = [];
  for (const k of keys) {
    const e = by.get(k);
    if (!e) continue;
    const pct = e.changePct > 0 ? `${toFa(e.changePct.toFixed(2).replace(/\.?0+$/, '').replace('.', '٫'))}٪` : '';
    out.push({
      label: classify(k).title, price: priceText(e, unit),
      change: e.dir && pct ? `${e.dir === 'up' ? '▲' : '▼'} ${pct}` : '', dir: e.dir,
    });
    if (out.length >= MAX_WIDGET_ROWS) break;
  }
  return out;
}

/** پیکربندی دریافتی از وب‌ویو را اعتبارسنجی می‌کند (ورودی نامطمئن) */
export function sanitizeConfig(raw: unknown): WidgetConfig | null {
  const c = raw as Partial<WidgetConfig> | null;
  if (!c || typeof c !== 'object') return null;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const rows = Array.isArray(c.rows)
    ? c.rows.slice(0, MAX_WIDGET_ROWS).map((r) => ({
        label: str((r as WidgetRow)?.label, 40), price: str((r as WidgetRow)?.price, 40), change: str((r as WidgetRow)?.change, 20),
        dir: (r as WidgetRow)?.dir === 'up' || (r as WidgetRow)?.dir === 'down' ? (r as WidgetRow).dir : '',
      } as WidgetRow))
    : [];
  return {
    keys: Array.isArray(c.keys) ? c.keys.filter((k): k is string => typeof k === 'string' && k.length < 80).slice(0, 40) : [],
    unit: c.unit === 'rial' ? 'rial' : 'toman',
    showWorth: c.showWorth === true,
    worth: c.showWorth === true && typeof c.worth === 'string' ? c.worth.slice(0, 40) : null,
    rows,
    updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt.slice(0, 40) : null,
  };
}

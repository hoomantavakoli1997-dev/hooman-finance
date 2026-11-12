import { Decimal } from './decimal';
import type { FetchLike, PriceProvider, Quote } from './prices';

/**
 * قیمت سهام بورس ایران از سرویس عمومی TSETMC.
 * فرمت پاسخ‌ها از کتابخانه‌های متن‌باز و مستندات عمومی گرفته شده و باید با پاسخ واقعی تطبیق داده شود
 * (در برنامه «نمایش قیمت آزمایشی» همین کار را می‌کند). هر پاسخ غیرمنتظر خطا می‌دهد، نه قیمت حدسی.
 * قیمت‌ها به ریال و «آخرین معامله» هستند.
 */

export const TSETMC_BASE = 'https://cdn.tsetmc.com/api/';
const TEHRAN = '+03:30';

const INS_RE = /^\d{5,25}$/;
export const isInsCode = (s: string): boolean => INS_RE.test(s);

/** پایگاه TSETMC حرف‌های عربی «ي» و «ك» دارد؛ ورودی فارسی برای جست‌وجو تبدیل می‌شود */
export const toTsetmcText = (s: string): string => s.replace(/ی/g, 'ي').replace(/ک/g, 'ك').replace(/‌/g, ' ').trim();
export const fromTsetmcText = (s: string): string => s.replace(/ي/g, 'ی').replace(/ك/g, 'ک');

export const searchUrl = (text: string): string =>
  `${TSETMC_BASE}Instrument/GetInstrumentSearch/${encodeURIComponent(toTsetmcText(text))}`;

export function quoteUrl(insCode: string): string {
  if (!isInsCode(insCode)) throw new Error('کد نماد معتبر نیست (فقط رقم).');
  return `${TSETMC_BASE}ClosingPrice/GetClosingPriceInfo/${insCode}`;
}

function asJson(raw: string | unknown): Record<string, unknown> {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      throw new Error('پاسخ بورس قابل خواندن نبود.');
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('پاسخ بورس ساختار انتظار‌رفته را نداشت.');
  return v as Record<string, unknown>;
}

export interface InstrumentHit {
  insCode: string;
  symbol: string;
  name: string;
}

export function parseSearch(raw: string | unknown): InstrumentHit[] {
  const j = asJson(raw);
  const list = j.instrumentSearch;
  if (!Array.isArray(list)) throw new Error('پاسخ جست‌وجوی بورس ساختار انتظار‌رفته را نداشت.');
  const out: InstrumentHit[] = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const insCode = String(o.insCode ?? '');
    const symbol = typeof o.lVal18AFC === 'string' ? o.lVal18AFC : '';
    // flow=3 بازار مشتقه است (اختیار معامله)؛ قیمت آن به درد دارایی نمی‌خورد
    if (o.flow === 3) continue;
    if (!isInsCode(insCode) || !symbol) continue;
    out.push({ insCode, symbol: fromTsetmcText(symbol.trim()), name: fromTsetmcText(String(o.lVal30 ?? '').trim()) });
  }
  return out;
}

export interface StockQuote extends Quote {
  /** قیمت پایانی و دیروز (ریال)، اگر در پاسخ بود */
  closing: Decimal | null;
  yesterday: Decimal | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** dEven = YYYYMMDD میلادی، hEven = HHMMSS (بدون صفر ابتدایی) به وقت تهران */
export function parseClosingInfo(raw: string | unknown, insCode: string): StockQuote {
  const j = asJson(raw);
  const c = j.closingPriceInfo;
  if (!c || typeof c !== 'object') throw new Error('پاسخ قیمت بورس ساختار انتظار‌رفته را نداشت.');
  const o = c as Record<string, unknown>;
  const last = num(o.pDrCotVal);
  const closing = num(o.pClosing);
  const price = last && last > 0 ? last : closing && closing > 0 ? closing : null;
  if (price === null) throw new Error('قیمتی برای این نماد ثبت نشده (معامله‌ای نشده یا نماد بسته است).');
  if (!Number.isInteger(price)) throw new Error('قیمت بورس عدد صحیح نبود و رد شد.');
  const d = num(o.dEven);
  const h = num(o.hEven);
  if (d === null || !Number.isInteger(d) || d < 20000101 || d > 20991231) throw new Error('تاریخ معامله در پاسخ بورس نبود.');
  const ds = String(d);
  const hs = String(h !== null && Number.isInteger(h) && h >= 0 && h <= 235959 ? h : 0).padStart(6, '0');
  const iso = `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}T${hs.slice(0, 2)}:${hs.slice(2, 4)}:${hs.slice(4, 6)}${TEHRAN}`;
  const atMs = Date.parse(iso);
  if (Number.isNaN(atMs)) throw new Error('تاریخ معامله معتبر نبود.');
  const y = num(o.priceYesterday);
  return {
    key: insCode,
    price: Decimal.parse(String(price)),
    at: iso,
    atMs,
    // قیمت آخرین معامله است نه لحظه‌ای؛ مانند قیمت‌های روزانه با پنجره‌ی چندروزه سنجیده می‌شود (آخر هفته و تعطیلی)
    dateOnly: true,
    closing: closing && closing > 0 ? Decimal.parse(String(closing)) : null,
    yesterday: y && y > 0 ? Decimal.parse(String(y)) : null,
  };
}

/** قیمت چند نماد؛ خطای یک نماد جلوی بقیه را نمی‌گیرد، ولی اگر همه خطا بدهند خطا برمی‌گردد */
export function tsetmcProvider(fetchFn: FetchLike, insCodes: string[], timeoutMs = 15000): PriceProvider {
  const codes = [...new Set(insCodes.filter(isInsCode))];
  return {
    id: 'tsetmc',
    name: 'بورس (TSETMC)',
    async fetchQuotes() {
      const quotes: Quote[] = [];
      let lastErr = '';
      for (const code of codes) {
        try {
          const res = await Promise.race([
            fetchFn(quoteUrl(code)),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('پاسخی نیامد (زمان تمام شد).')), timeoutMs)),
          ]);
          if (!res.ok) throw new Error(`پاسخ نامعتبر از سرور (${res.status}).`);
          quotes.push(parseClosingInfo(await res.text(), code));
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
        }
      }
      if (codes.length > 0 && quotes.length === 0) throw new Error(lastErr || 'دریافت قیمت بورس ناموفق بود.');
      return quotes;
    },
  };
}

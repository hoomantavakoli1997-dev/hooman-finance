import { Decimal } from './decimal';
import { Asset, PriceEntry } from './types';

/**
 * قیمت خودکار: چند منبع پشت یک رابط مشترک.
 * قواعد ایمنی: هر قیمت قدیمی، صفر یا جهشی مشکوک رد می‌شود و آخرین قیمت معتبر باقی می‌ماند.
 * همه‌ی قیمت‌ها ریال به ازای هر واحد هستند (TGJU هم به ریال می‌دهد).
 */

export interface Quote {
  key: string;
  /** ریال به ازای هر واحد */
  price: Decimal;
  /** زمان قیمت، ISO همراه با ساعت تهران */
  at: string;
  atMs: number;
  /** اگر منبع فقط تاریخ داده (ساعت ۰۰:۰۰:۰۰) */
  dateOnly: boolean;
}

export interface PriceProvider {
  id: string;
  name: string;
  fetchQuotes(): Promise<Quote[]>;
}

/** نگاشت پیش‌فرض دارایی‌ها به کلید هر منبع (فقط کلیدهایی که با داده‌ی واقعی بررسی شده‌اند) */
export const DEFAULT_PRICE_KEYS: Record<string, Record<string, string>> = {
  tgju: { gold: 'geram18', usd: 'price_dollar_rl', usdt: 'crypto-tether-irr' },
};

export function priceKeyFor(asset: Asset, providerId: string): string | undefined {
  return asset.priceKeys?.[providerId] ?? DEFAULT_PRICE_KEYS[providerId]?.[asset.id];
}

/* ------------------------------ TGJU ------------------------------ */

/** ایران ساعت تابستانی ندارد (از ۱۴۰۱)؛ ساعت‌های TGJU به وقت تهران است */
const TEHRAN = '+03:30';
const TS_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

export function parseTs(ts: string): { iso: string; ms: number; dateOnly: boolean } | null {
  const m = TS_RE.exec(ts);
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}${TEHRAN}`;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return { iso, ms, dateOnly: m[2] === '00' && m[3] === '00' && m[4] === '00' };
}

/** پاسخ https://call.tgju.org/ajax.json ← فهرست قیمت‌ها. ورودی غیرمنتظر خطا می‌دهد، نه قیمت حدسی */
export function parseTgju(raw: string | unknown): Quote[] {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('پاسخ TGJU JSON معتبر نیست.');
    }
  }
  const current = (data as { current?: unknown } | null)?.current;
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error('پاسخ TGJU قالب مورد انتظار را ندارد.');
  }
  const out: Quote[] = [];
  for (const [key, v] of Object.entries(current as Record<string, unknown>)) {
    const e = v as { p?: unknown; ts?: unknown } | null;
    if (!e || typeof e.p !== 'string' || typeof e.ts !== 'string') continue;
    const t = parseTs(e.ts);
    if (!t) continue;
    let price: Decimal;
    try {
      price = Decimal.parse(e.p.replace(/,/g, ''));
    } catch {
      continue;
    }
    out.push({ key, price, at: t.iso, atMs: t.ms, dateOnly: t.dateOnly });
  }
  return out;
}

export interface FetchLike {
  (url: string): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
}

export const TGJU_URL = 'https://call.tgju.org/ajax.json';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('پاسخی نیامد (زمان تمام شد).')), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** onRaw: متن خام پاسخ سالم را هم تحویل می‌دهد (برای نمای بازار) */
export function tgjuProvider(
  fetchFn: FetchLike,
  url: string = TGJU_URL,
  timeoutMs = 15000,
  onRaw?: (raw: string) => void,
): PriceProvider {
  return {
    id: 'tgju',
    name: 'TGJU',
    async fetchQuotes() {
      const res = await withTimeout(fetchFn(url), timeoutMs);
      if (!res.ok) throw new Error(`پاسخ نامعتبر از سرور (${res.status}).`);
      const raw = await withTimeout(res.text(), timeoutMs);
      const quotes = parseTgju(raw);
      if (onRaw) onRaw(raw);
      return quotes;
    },
  };
}

/* ------------------------------ اعمال قیمت‌ها ------------------------------ */

export type PriceStatus = 'updated' | 'unchanged' | 'no-key' | 'missing' | 'stale' | 'invalid' | 'suspicious' | 'failed';

export interface PriceResult {
  assetId: string;
  status: PriceStatus;
  message: string;
}

export interface ApplyOptions {
  now: number;
  /** حداکثر سن قیمت‌های دارای ساعت */
  maxAgeLiveMs?: number;
  /** حداکثر سن قیمت‌های فقط‌تاریخ (آخر هفته و تعطیلی‌ها را هم پوشش بدهد) */
  maxAgeDateOnlyMs?: number;
  /** حداکثر تغییر نسبی نسبت به قیمت خودکار قبلی */
  maxJump?: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function applyQuotes(
  assets: Asset[],
  prices: Record<string, PriceEntry>,
  quotes: Quote[],
  provider: PriceProvider | { id: string; name: string },
  opt: ApplyOptions,
  only?: Set<string>,
): { prices: Record<string, PriceEntry>; results: PriceResult[] } {
  const maxLive = opt.maxAgeLiveMs ?? 6 * HOUR;
  const maxDate = opt.maxAgeDateOnlyMs ?? 4 * DAY;
  const maxJump = opt.maxJump ?? 0.3;
  const byKey = new Map(quotes.map((q) => [q.key, q]));
  const next = { ...prices };
  const results: PriceResult[] = [];

  for (const asset of assets) {
    if (only && !only.has(asset.id)) continue;
    const key = priceKeyFor(asset, provider.id);
    const res = (status: PriceStatus, message: string) => results.push({ assetId: asset.id, status, message });
    if (!key) {
      res('no-key', 'برای این دارایی منبع خودکار تعریف نشده است.');
      continue;
    }
    const q = byKey.get(key);
    if (!q) {
      res('missing', `قیمت «${key}» در پاسخ ${provider.name} نبود.`);
      continue;
    }
    if (q.price.lte(0)) {
      res('invalid', 'قیمت دریافتی صفر یا منفی بود و رد شد.');
      continue;
    }
    const age = opt.now - q.atMs;
    if (age > (q.dateOnly ? maxDate : maxLive)) {
      res('stale', `قیمت ${provider.name} قدیمی است (${q.at.slice(0, 10)}) و رد شد.`);
      continue;
    }
    const old = prices[asset.id];
    const oldPrice = old ? Decimal.parse(old.price) : null;
    if (oldPrice && old.source === 'auto' && oldPrice.gt(0)) {
      const jump = q.price.minus(oldPrice).div(oldPrice);
      const abs = jump.isNegative() ? jump.neg() : jump;
      if (abs.gt(maxJump)) {
        res('suspicious', 'قیمت جدید بیش از حد با قیمت قبلی فرق دارد و اعمال نشد. اگر درست است، قیمت را دستی ثبت کنید.');
        continue;
      }
    }
    if (old && old.source === 'auto' && oldPrice && oldPrice.eq(q.price) && old.at === q.at) {
      res('unchanged', 'قیمت تغییری نکرده است.');
      continue;
    }
    next[asset.id] = {
      assetId: asset.id,
      price: q.price.toString(),
      source: 'auto',
      at: q.at,
      provider: provider.id,
      fetchedAt: new Date(opt.now).toISOString(),
      dateOnly: q.dateOnly,
    };
    res('updated', `قیمت از ${provider.name} به‌روز شد.`);
  }
  return { prices: next, results };
}

export interface RefreshOutcome {
  prices: Record<string, PriceEntry>;
  results: PriceResult[];
  errors: { provider: string; message: string }[];
}

/** منبع‌ها را به ترتیب امتحان می‌کند؛ هر دارایی از اولین منبعی که قیمت معتبر داد به‌روز می‌شود */
export async function refreshPrices(
  assets: Asset[],
  prices: Record<string, PriceEntry>,
  providers: PriceProvider[],
  opt: ApplyOptions,
): Promise<RefreshOutcome> {
  const errors: RefreshOutcome['errors'] = [];
  const final = new Map<string, PriceResult>();
  let current = prices;
  let pending = new Set(assets.map((a) => a.id));

  for (const p of providers) {
    if (pending.size === 0) break;
    let quotes: Quote[];
    try {
      quotes = await p.fetchQuotes();
    } catch (e) {
      errors.push({ provider: p.name, message: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const r = applyQuotes(assets, current, quotes, p, opt, pending);
    current = r.prices;
    for (const res of r.results) {
      final.set(res.assetId, res);
      if (res.status === 'updated' || res.status === 'unchanged') pending.delete(res.assetId);
    }
  }
  for (const a of assets) {
    if (!final.has(a.id)) {
      final.set(a.id, {
        assetId: a.id,
        status: errors.length ? 'failed' : 'no-key',
        message: errors.length ? 'دریافت قیمت ناموفق بود.' : 'برای این دارایی منبع خودکار تعریف نشده است.',
      });
    }
  }
  return { prices: current, results: assets.map((a) => final.get(a.id) as PriceResult), errors };
}

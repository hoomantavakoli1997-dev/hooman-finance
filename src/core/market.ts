import { Decimal } from './decimal';
import { parseTs } from './prices';

/**
 * نمای بازار: همه‌ی قیمت‌های پاسخ TGJU با نام فارسی، دسته و واحد.
 * اصل: واحد فقط وقتی نشان داده می‌شود که از روی بزرگی عددها یا نام کلید مطمئن باشیم؛
 * بقیه بدون واحد و با کلید اصلی نمایش داده می‌شوند. هیچ واحدی حدس زده نمی‌شود.
 */

export type CategoryId = 'gold' | 'currency' | 'crypto' | 'metal' | 'ime' | 'other';
export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'gold', label: 'طلا و سکه' },
  { id: 'currency', label: 'ارز' },
  { id: 'crypto', label: 'رمزارز' },
  { id: 'metal', label: 'فلزات و کالا' },
  { id: 'ime', label: 'بورس کالا' },
  { id: 'other', label: 'سایر' },
];

/** irr = ریال، usd = دلار، none = واحد مشخص نیست */
export type MarketUnit = 'irr' | 'usd' | 'none';

export interface MarketEntry {
  key: string;
  /** عدد بدون جداکننده */
  price: string;
  high: string;
  low: string;
  change: string;
  changePct: number;
  dir: 'up' | 'down' | '';
  /** ISO با ساعت تهران */
  at: string;
  atMs: number;
  dateOnly: boolean;
}

export interface MarketMeta {
  category: CategoryId;
  title: string;
  unit: MarketUnit;
  /** توضیح واحد، مثل «هر ۱۰۰ ین» */
  per?: string;
  /** آیا نام فارسی دارد (برای نمایش کلید اصلی کنار نام) */
  named: boolean;
}

function num(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.replace(/,/g, '').trim();
  try {
    Decimal.parse(s);
    return s;
  } catch {
    return '';
  }
}

export function parseMarket(raw: string | unknown): MarketEntry[] {
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
  const out: MarketEntry[] = [];
  for (const [key, v] of Object.entries(current as Record<string, unknown>)) {
    const e = v as { p?: unknown; h?: unknown; l?: unknown; d?: unknown; dp?: unknown; dt?: unknown; ts?: unknown } | null;
    if (!e || typeof e.ts !== 'string') continue;
    const price = num(e.p);
    const t = parseTs(e.ts);
    if (!price || !t) continue;
    out.push({
      key, price, high: num(e.h), low: num(e.l), change: num(e.d),
      changePct: typeof e.dp === 'number' && Number.isFinite(e.dp) ? e.dp : 0,
      dir: e.dt === 'high' ? 'up' : e.dt === 'low' ? 'down' : '',
      at: t.iso, atMs: t.ms, dateOnly: t.dateOnly,
    });
  }
  return out;
}

const HOUR = 3_600_000;
export function isStale(e: MarketEntry, now: number): boolean {
  return now - e.atMs > (e.dateOnly ? 4 * 24 * HOUR : 6 * HOUR);
}

/** زمان داده: تازه‌ترین قیمت ساعت‌دار (اگر نبود تازه‌ترین تاریخ) */
export function snapshotTime(entries: MarketEntry[]): number {
  let live = 0;
  let any = 0;
  for (const e of entries) {
    if (e.atMs > any) any = e.atMs;
    if (!e.dateOnly && e.atMs > live) live = e.atMs;
  }
  return live || any;
}

/* ------------------------------ نام و دسته ------------------------------ */

const CURRENCY: Record<string, string> = {
  aed: 'درهم امارات', afn: 'افغانی', all: 'لک آلبانی', amd: 'درام ارمنستان', aud: 'دلار استرالیا',
  azn: 'منات آذربایجان', bgn: 'لو بلغارستان', bhd: 'دینار بحرین', brl: 'رئال برزیل', cad: 'دلار کانادا',
  chf: 'فرانک سوئیس', cny: 'یوان چین', czk: 'کرون چک', dkk: 'کرون دانمارک', egp: 'پوند مصر', eur: 'یورو',
  gbp: 'پوند انگلیس', gel: 'لاری گرجستان', hkd: 'دلار هنگ‌کنگ', huf: 'فورینت مجارستان', idr: 'روپیه اندونزی',
  inr: 'روپیه هند', iqd: 'دینار عراق', jod: 'دینار اردن', jpy: 'ین ژاپن', kgs: 'سوم قرقیزستان', krw: 'وون کره جنوبی',
  kwd: 'دینار کویت', kzt: 'تنگه قزاقستان', lbp: 'لیر لبنان', mxn: 'پزوی مکزیک', myr: 'رینگیت مالزی',
  nok: 'کرون نروژ', nzd: 'دلار نیوزیلند', omr: 'ریال عمان', pkr: 'روپیه پاکستان', pln: 'زلوتی لهستان',
  qar: 'ریال قطر', ron: 'لئوی رومانی', rub: 'روبل روسیه', sar: 'ریال عربستان', sek: 'کرون سوئد',
  sgd: 'دلار سنگاپور', thb: 'بات تایلند', tjs: 'سامانی تاجیکستان', tmt: 'منات ترکمنستان', try: 'لیر ترکیه',
  twd: 'دلار تایوان', uah: 'گریونای اوکراین', uzs: 'سوم ازبکستان', vnd: 'دونگ ویتنام', zar: 'رند آفریقای جنوبی',
  usd: 'دلار آمریکا',
};

const CRYPTO: Record<string, string> = {
  bitcoin: 'بیت‌کوین', ethereum: 'اتریوم', tether: 'تتر', ripple: 'ریپل', litecoin: 'لایت‌کوین',
  dogecoin: 'دوج‌کوین', solana: 'سولانا', cardano: 'کاردانو', tron: 'ترون', 'binance-coin': 'بایننس کوین',
  toncoin: 'تون‌کوین', stellar: 'استلار', chainlink: 'چین‌لینک', polkadot: 'پولکادات', avalanche: 'آوالانچ',
  'shiba-inu': 'شیبا اینو', monero: 'مونرو', eos: 'ایاس', dash: 'دش', 'bitcoin-cash': 'بیت‌کوین کش',
  'usd-coin': 'یو‌اس‌دی کوین', cosmos: 'کازماس', zcash: 'زی‌کش', 'ethereum-classic': 'اتریوم کلاسیک',
};

const GOLD_BASE: Record<string, string> = {
  sekee: 'سکه امامی', sekeb: 'سکه بهار آزادی', nim: 'نیم‌سکه', rob: 'ربع‌سکه', gerami: 'سکه گرمی',
};

function titleCase(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const m = (category: CategoryId, title: string, unit: MarketUnit, per?: string): MarketMeta => ({
  category, title, unit, per, named: true,
});

const CURATED: Record<string, MarketMeta> = {
  geram18: m('gold', 'طلای ۱۸ عیار (هر گرم)', 'irr'),
  geram24: m('gold', 'طلای ۲۴ عیار (هر گرم)', 'irr'),
  mesghal: m('gold', 'مثقال طلا', 'irr'),
  tgju_gold_irg18: m('gold', 'طلای ۱۸ عیار (زنده)', 'irr'),
  tgju_gold_irg18_buy: m('gold', 'طلای ۱۸ عیار (قیمت خرید)', 'irr'),
  coin_blubber: m('gold', 'حباب سکه', 'irr'),
  price_dollar_rl: m('currency', 'دلار آمریکا', 'irr'),
  ons: m('metal', 'انس جهانی طلا', 'usd', 'هر اونس'),
  silver: m('metal', 'انس نقره', 'usd', 'هر اونس'),
  platinum: m('metal', 'انس پلاتین', 'usd', 'هر اونس'),
  palladium: m('metal', 'انس پالادیوم', 'usd', 'هر اونس'),
  silver_999: m('metal', 'نقره ۹۹۹ (هر گرم)', 'irr'),
  silver_925: m('metal', 'نقره ۹۲۵ (هر گرم)', 'irr'),
  oil_brent: m('metal', 'نفت برنت', 'usd', 'هر بشکه'),
  oil_opec: m('metal', 'نفت اوپک', 'usd', 'هر بشکه'),
  tether_gold_xaut: m('crypto', 'تتر گلد (XAUT)', 'usd'),
  bourse: m('other', 'شاخص بورس (کل)', 'none'),
};

export function classify(key: string): MarketMeta {
  const cur = CURATED[key];
  if (cur) return cur;

  let r: RegExpExecArray | null;
  // سکه‌ها
  if ((r = /^(sekee|sekeb|nim|rob|gerami)$/.exec(key))) return m('gold', GOLD_BASE[r[1]], 'irr');
  if ((r = /^retail_(sekee|sekeb|nim|rob|gerami)$/.exec(key))) return m('gold', `${GOLD_BASE[r[1]]} (خرده‌فروشی)`, 'irr');
  if ((r = /^(sekee|nim|rob)_down$/.exec(key))) return m('gold', `${GOLD_BASE[r[1]]} (تاریخ پایین)`, 'irr');
  if ((r = /^(sekeb|nim|rob|gerami)_blubber$/.exec(key))) return m('gold', `حباب ${GOLD_BASE[r[1]]}`, 'irr');
  // رمزارز: -irr = ریال، بدون پسوند = دلار
  if ((r = /^crypto-(.+)-(irr|irc)$/.exec(key))) return m('crypto', CRYPTO[r[1]] ?? titleCase(r[1]), 'irr');
  if ((r = /^crypto-(.+)$/.exec(key))) return m('crypto', CRYPTO[r[1]] ?? titleCase(r[1]), 'usd');
  if ((r = /^crypto_(.+)$/.exec(key))) return { category: 'crypto', title: titleCase(r[1]), unit: 'usd', named: false };
  // ارزهای کشورها: قیمت هر یک واحد به ریال (ین: هر ۱۰۰ ین، از روی بزرگی عدد)
  if ((r = /^price_([a-z]{3})$/.exec(key)) && CURRENCY[r[1]]) {
    return m('currency', CURRENCY[r[1]], 'irr', r[1] === 'jpy' ? 'هر ۱۰۰ ین' : undefined);
  }
  if ((r = /^price_([a-z]{3})$/.exec(key))) {
    return { category: 'currency', title: `ارز ${r[1].toUpperCase()}`, unit: 'irr', named: false };
  }
  // صرافی‌ها و مرکز مبادله: ریال
  if ((r = /^([a-z0-9]+)_([a-z0-9-]+)_(sell|buy)$/.exec(key)) && !r[1].startsWith('ice')) {
    const what = CURRENCY[r[2]] ?? r[2].toUpperCase();
    return { category: 'currency', title: `${r[1]} · ${what} (${r[3] === 'sell' ? 'فروش' : 'خرید'})`, unit: 'irr', named: false };
  }
  if ((r = /^ice_transfer_([a-z]{3})_(sell|buy)$/.exec(key))) {
    const what = CURRENCY[r[1]] ?? r[1].toUpperCase();
    return { category: 'currency', title: `حواله مرکز مبادله · ${what} (${r[2] === 'sell' ? 'فروش' : 'خرید'})`, unit: 'irr', named: true };
  }
  if (/^(sekee|sekeb|nim|rob|gerami|geram|retail|mesghal)/.test(key)) {
    return { category: 'gold', title: key, unit: 'none', named: false };
  }
  if (/^ime_/.test(key)) return { category: 'ime', title: key, unit: 'none', named: false };
  if (/^(gold_|irec_|irhc_|irqc_|irbc_|irgc_)/.test(key)) {
    return { category: 'gold', title: key, unit: 'none', named: false };
  }
  if (/^(commodities|basemetal|base-us|energy|copperp|cobalt|nuclear|solar|propane|naphtha|methanol|urals|dme|coking|central_|louisiana|azeri|kansas|upper_|umm_|lula)/.test(key)) {
    return { category: 'metal', title: key, unit: 'none', named: false };
  }
  return { category: 'other', title: key, unit: 'none', named: false };
}

/* ------------------------------ جست‌وجو ------------------------------ */

const FA_DIGITS = /[۰-۹]/g;
const norm = (s: string) =>
  s.replace(FA_DIGITS, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[‌‏‎]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase();

/** مهم‌ترین قیمت‌ها که همیشه اول فهرست می‌آیند */
export const PRIORITY = ['geram18', 'price_dollar_rl', 'crypto-tether-irr', 'sekee', 'mesghal', 'ons', 'crypto-bitcoin-irr'];

export interface MarketQuery {
  text: string;
  category: CategoryId | 'all';
  includeStale: boolean;
  now: number;
}

/** نتیجه: اول قیمت‌های تازه، بعد نام فارسی‌دارها، بعد به ترتیب نام */
export function searchMarket(entries: MarketEntry[], q: MarketQuery): MarketEntry[] {
  const needle = norm(q.text.trim());
  const withMeta = entries
    .map((e) => ({ e, meta: classify(e.key), stale: isStale(e, q.now) }))
    .filter(({ meta, stale, e }) => {
      if (!q.includeStale && stale) return false;
      if (q.category !== 'all' && meta.category !== q.category) return false;
      if (!needle) return true;
      return norm(`${meta.title} ${e.key}`).includes(needle);
    });
  const catRank = (c: CategoryId) => CATEGORIES.findIndex((x) => x.id === c);
  const prio = (k: string) => {
    const i = PRIORITY.indexOf(k);
    return i < 0 ? 999 : i;
  };
  withMeta.sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? 1 : -1;
    const pa = prio(a.e.key);
    const pb = prio(b.e.key);
    if (pa !== pb) return pa - pb;
    if (a.meta.named !== b.meta.named) return a.meta.named ? -1 : 1;
    const ca = catRank(a.meta.category);
    const cb = catRank(b.meta.category);
    if (ca !== cb) return ca - cb;
    return a.meta.title.localeCompare(b.meta.title, 'fa');
  });
  return withMeta.map((x) => x.e);
}

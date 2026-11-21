import { AUTO_LOCK_OPTIONS, DEFAULT_AUTO_LOCK, PATTERN_MIN, PIN_MAX, PIN_MIN, hashSecret, isValidSecret, lockoutMs, normalizePin, verifySecret, type LockKind, type PinRecord } from '../src/core/lock';
import { BackupError, MIN_PASSPHRASE, decryptBackup, encryptBackup } from '../src/core/backup';
import { Decimal } from '../src/core/decimal';
import {
  addTx, computeAssetState, computeCash, computePortfolio, deleteTx, restoreTx, updateTx,
  ChangeResult, Portfolio, TxDraft, parseDec,
} from '../src/core/engine';
import { Asset, CASH_ID, PriceEntry, Tx, TxType } from '../src/core/types';
import { Cheque, CheckDirection, CheckStatus, chequeCashDraft, chequeOutstanding, chequeDue, chequeTotals, duplicateCheque, sortCheques, validateCheque } from '../src/core/checks';
import { assetIcon, iconKind, iconSvg, marketIcon } from './icons';
import { InstrumentHit, isInsCode, parseClosingInfo, parseSearch, quoteUrl, searchUrl, tsetmcProvider } from '../src/core/tsetmc';
import { DEFAULT_PRICE_KEYS, PriceResult, TGJU_URL, applyQuotes, parseTgju, refreshPrices, tgjuProvider } from '../src/core/prices';
import {
  CATEGORIES, CategoryId, MarketEntry, classify, isStale, parseMarket, searchMarket, snapshotTime,
} from '../src/core/market';
import { Envelope, decryptText, encryptText, importKey, parseEnvelope, secureAvailable, validKeyHex } from './secure';
import { esc, fmtNum, toEn, toFa } from './format';
import { buildRows } from '../src/native/widgetData';
import sampleRaw from './market-sample.json';
import { INCOME_LABEL, IncomeKind, accrualInterest, incomeDraft, incomeTotals, validateIncome } from '../src/core/income';
import { FamilyItem, FamilyOpts, familyReportText } from '../src/core/familyreport';
import { monthRange, monthReport, monthTitle, reportCsv, shiftMonth, txCsv } from '../src/core/report';
import { AllocId, computeAllocation } from '../src/core/allocation';
import { LoanMethod, LoanResult, computeLoan, impliedAnnualRate, validateLoan } from '../src/core/loan';
import { GOLD_ID, PriceLog, USD_ID, computeRealReturn, logPrices, type Bench } from '../src/core/realreturn';
import { formatJalali, isoToJalali, jalaliToIso, todayIso } from '../src/core/jalali';
import {
  DEFAULT_REMINDER_SETTINGS, LEAD_OPTIONS, PriceReminder, Reminder, ReminderEvent, ReminderSettings, activeEvents, addDaysIso,
  dateEvents, daysBetween, installmentEvents, priceHit, scheduleNotes, validateReminder,
} from '../src/core/reminders';
import {
  Debt, DebtPayment, DebtState, Direction, PeopleData, Person, addJalaliMonths, cashEffect, computeDebt,
  computePeople, netWorth, validatePeople,
} from '../src/core/people';

/* ============================== وضعیت ============================== */

type Tab = 'home' | 'assets' | 'txs' | 'people' | 'settings';
interface Settings {
  /** پنهان کردن مبلغ‌ها (برای وقتی دیگران نگاه می‌کنند) */
  hide?: boolean;
  /** نمایش سرمایه‌ی خالص روی ویجت صفحه‌ی اصلی گوشی (پیش‌فرض خاموش) */
  widgetWorth?: boolean;
  /** راهنمای اول کار نشان داده شده یا رد شده است */
  onboarded?: boolean;
  /** نرخ تورم سالانه‌ی واردشده‌ی کاربر (٪)؛ تخمین دستی است */
  inflation?: number;
  /** کلید قیمت‌های منتخب برای نمایش در خانه (اگر نباشد، فهرست پیش‌فرض) */
  favs?: string[];
  /** آخرین باری که فایل پشتیبان ساخته شد (ISO) */
  lastBackup?: string;
  /** قفل برنامه: هش رمز، اثر انگشت و مدت قفل خودکار (ثانیه) */
  lock?: PinRecord & { bio?: boolean; after?: number };
  /** تنظیم یادآورها (اقساط، ساعت اعلان) */
  rem?: Partial<ReminderSettings>;
  unit: 'toman' | 'rial';
  theme: 'system' | 'light' | 'dark';
  font: 'small' | 'normal' | 'large';
}
interface MarketSnapshot {
  source: 'sample' | 'tgju' | 'pasted';
  entries: MarketEntry[];
}
interface HistoryPoint { at: string; value: string }
interface Store {
  v: 1;
  sample: boolean;
  market?: MarketSnapshot;
  assets: Asset[];
  txs: Tx[];
  prices: Record<string, PriceEntry>;
  people: Person[];
  debts: Debt[];
  payments: DebtPayment[];
  settings: Settings;
  /** یادآورهای دلخواه: تاریخ و هشدار قیمت */
  reminders?: Reminder[];
  /** تاریخچه‌ی ارزش کل سرمایه؛ فقط از زمان نصب نسخه‌ی دارای این قابلیت ثبت می‌شود. */
  history?: HistoryPoint[];
  cheques?: Cheque[];
  /** قیمت‌های خودکار روزانه‌ی دلار و طلا برای مقایسه‌ی سود واقعی */
  priceLog?: PriceLog;
}

const KEY = 'hooman-finance-prototype-v1';
const DEFAULT_ASSETS: Asset[] = [
  { id: 'gold', name: 'طلا ۱۸ عیار', unit: 'گرم', kind: 'metal', decimals: 3 },
  { id: 'usd', name: 'دلار', unit: 'دلار', kind: 'currency', decimals: 2 },
  { id: 'usdt', name: 'تتر', unit: 'تتر', kind: 'crypto', decimals: 2 },
];

const bundledMarket = (): MarketSnapshot => ({ source: 'sample', entries: parseMarket(sampleRaw) });
const mk = (): MarketSnapshot => store.market ?? (store.market = bundledMarket());

const jd = (y: number, m: number, d: number) => jalaliToIso(y, m, d)!;

function seed(): Store {
  let seq = 0;
  const t = (
    assetId: string, type: TxType, date: string, quantity: string, unitPrice: string, fee = '0',
  ): Tx => {
    seq += 1;
    return { id: `t${seq}`, seq, assetId, type, date, quantity, unitPrice, fee, deletedAt: null };
  };
  const at = new Date().toISOString();
  const p = (assetId: string, price: string): PriceEntry => ({ assetId, price, source: 'manual', at });
  return {
    v: 1,
    sample: true,
    market: bundledMarket(),
    assets: DEFAULT_ASSETS.map((a) => ({ ...a })),
    txs: [
      t(CASH_ID, 'deposit', '2026-08-25', '10000000000', '1'),
      t('gold', 'buy', '2026-09-05', '10', '240000000', '2000000'),
      t('gold', 'buy', '2026-09-20', '5', '250000000'),
      t('usd', 'buy', '2026-10-01', '1000', '2600000'),
      t('usdt', 'buy', '2026-10-03', '500', '2650000'),
      t('gold', 'sell', '2026-10-10', '3', '258000000', '1000000'),
    ],
    prices: { gold: p('gold', '258000000'), usd: p('usd', '2680000'), usdt: p('usdt', '2690000') },
    people: [{ id: 'p1', name: 'علی' }, { id: 'p2', name: 'بلو بانک' }],
    debts: [
      { id: 'd1', personId: 'p1', direction: 'lent', title: 'قرض', amount: '100000000', date: jd(1405, 2, 10) },
      {
        id: 'd2', personId: 'p2', direction: 'borrowed', title: 'وام بلو بانک', amount: '150000000', date: jd(1405, 4, 1),
        plan: { count: 8, installment: '20000000', firstDate: jd(1405, 5, 1), everyMonths: 1 },
      },
    ],
    payments: [
      ...[3, 4, 5, 6, 7].map((m, i): DebtPayment => ({ id: `q${i}`, debtId: 'd1', date: jd(1405, m, 10), amount: '10000000' })),
      ...[5, 6, 7].map((m, i): DebtPayment => ({ id: `r${i}`, debtId: 'd2', date: jd(1405, m, 1), amount: '20000000' })),
    ],
    settings: { unit: 'toman', theme: 'system', font: 'normal' },
  };
}

function emptyStore(settings: Settings, market?: MarketSnapshot): Store {
  return { v: 1, sample: false, market: market ?? bundledMarket(), assets: DEFAULT_ASSETS.map((a) => ({ ...a })), txs: [], prices: {}, people: [], debts: [], payments: [], cheques: [], settings };
}

/** یک متن ذخیره‌شده را بررسی و کامل می‌کند؛ اگر معتبر نباشد null */
function parseStore(raw: string | null | undefined): Store | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Store;
    if (!s || s.v !== 1 || !Array.isArray(s.assets) || !Array.isArray(s.txs) || !s.settings || typeof s.settings !== 'object') return null;
    if (!s.market || !Array.isArray(s.market.entries)) s.market = bundledMarket();
    if (!s.prices || typeof s.prices !== 'object') s.prices = {};
    for (const k of ['people', 'debts', 'payments', 'history', 'reminders', 'cheques'] as const) {
      if (!Array.isArray(s[k])) (s as unknown as Record<string, unknown[]>)[k] = [];
    }
    return s;
  } catch {
    return null;
  }
}

/**
 * وضعیت بارگذاری: اگر داده‌ی ذخیره‌شده وجود داشته ولی خوانده نشد، تا تصمیم کاربر هیچ‌چیز
 * بازنویسی نمی‌شود (نه حافظه‌ی مرورگر و نه آینه‌ی SQLite) تا داده‌ی قابل‌نجات از بین نرود.
 */
let writesBlocked = false;
let recoverMirror: Store | null = null;
let recoveredFromMirror = false;
const CORRUPT_PREFIX = 'hooman-finance-corrupt-';

/**
 * رمزنگاری روی گوشی: فقط وقتی بخش بومی کلید را داده باشد (نسخه‌ی اندروید) فعال است.
 * در این حالت اطلاعات به‌شکل پاکت رمزشده در پایگاه داده‌ی گوشی نگه‌داری می‌شود و متن ساده‌ای در
 * حافظه‌ی مرورگر باقی نمی‌ماند. نسخه‌ی وب (PWA) مثل قبل از حافظه‌ی مرورگر استفاده می‌کند.
 */
const injected = window as unknown as { __DARA_KEY?: string | null; __DARA_SQLITE_SNAPSHOT?: string | null };
const keyHex: string | null = validKeyHex(injected.__DARA_KEY) && secureAvailable() ? injected.__DARA_KEY : null;
let secureMode = !!keyHex;
let secureKey: CryptoKey | null = null;
let pendingEnvelope: Envelope | null = null;
/** متن سادهٔ قدیمی هنوز در حافظه‌ی مرورگر است و باید بعد از تأیید ذخیره‌ی رمزشده پاک شود */
let plainPending = false;

function load(): Store {
  const mirrorRaw = injected.__DARA_SQLITE_SNAPSHOT ?? null;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    /* حافظه‌ی مرورگر در دسترس نیست */
  }
  const env = parseEnvelope(mirrorRaw);
  if (env) {
    // نسخه‌ی رمزشده معتبرترین نسخه است. بدون کلید یا با کلید اشتباه، هیچ‌چیز بازنویسی نمی‌شود.
    writesBlocked = true;
    if (keyHex) pendingEnvelope = env;
    recoverMirror = parseStore(raw);
    return emptyStore({ unit: 'toman', theme: 'system', font: 'normal' });
  }
  if (raw) {
    const s = parseStore(raw);
    if (s) return s;
    // داده هست ولی خراب است: یک کپی کنار می‌گذاریم و هیچ‌چیز را بازنویسی نمی‌کنیم
    try { localStorage.setItem(CORRUPT_PREFIX + Date.now(), raw); } catch { /* ignore */ }
    recoverMirror = parseStore(mirrorRaw);
    writesBlocked = true;
    return emptyStore({ unit: 'toman', theme: 'system', font: 'normal' });
  }
  const fromMirror = parseStore(mirrorRaw);
  if (fromMirror) {
    recoveredFromMirror = true;
    return fromMirror;
  }
  // New installations start empty: never present seeded demo transactions as real finances.
  return emptyStore({ unit: 'toman', theme: 'system', font: 'normal' });
}

let store: Store = load();
let lastSaveWarn = 0;

let secTimer: number | undefined;
let secBusy = false;
let secDirty = false;
let secAck = 0;
function queueSecureSave(now = false) {
  secDirty = true;
  window.clearTimeout(secTimer);
  if (now) void flushSecure();
  else secTimer = window.setTimeout(() => void flushSecure(), 250);
}
async function flushSecure() {
  window.clearTimeout(secTimer);
  if (secBusy || !secureKey || writesBlocked) return;
  secBusy = true;
  try {
    while (secDirty) {
      secDirty = false;
      const env = await encryptText(secureKey, JSON.stringify(store));
      toNative({ type: 'sqlite-snapshot', snapshot: JSON.stringify(env), ack: ++secAck });
    }
  } catch {
    secDirty = true;
    toast('رمزنگاری و ذخیره‌ی اطلاعات انجام نشد. همین حالا پشتیبان بگیرید.');
  } finally {
    secBusy = false;
  }
}
function persist(): boolean {
  if (writesBlocked) return false;
  if (secureMode) {
    queueSecureSave();
    return true;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch {
    if (Date.now() - lastSaveWarn > 60_000) {
      lastSaveWarn = Date.now();
      window.setTimeout(() => toast('ذخیره‌ی اطلاعات انجام نشد. فضای گوشی را بررسی کنید و همین حالا پشتیبان بگیرید.'), 0);
    }
    return false;
  }
}
function save() {
  recordHistory();
  if (persist() && !secureMode) {
    // Mirror to native SQLite while localStorage remains the authoritative source during migration.
    const rn = (window as unknown as { ReactNativeWebView?: { postMessage(message: string): void } }).ReactNativeWebView;
    rn?.postMessage(JSON.stringify({ type: 'sqlite-snapshot', snapshot: JSON.stringify(store) }));
  }
  scheduleNoteSync();
  widgetSync();
}

/** پیکربندی و آخرین قیمت‌ها را برای ویجت صفحه‌ی اصلی گوشی می‌فرستد (فقط داخل اپ) */
let widgetTimer: number | undefined;
function widgetSync() {
  if (!inApp()) return;
  window.clearTimeout(widgetTimer);
  widgetTimer = window.setTimeout(() => {
    const unit = isToman() ? 'toman' : 'rial';
    const keys = favKeys();
    const m = mk();
    // نمونه‌ی همراه برنامه قیمت زنده نیست؛ هرگز روی ویجت نشان داده نمی‌شود
    const live = m.source !== 'sample';
    const t = live ? snapshotTime(m.entries) : 0;
    let worth: string | null = null;
    if (store.settings.widgetWorth && !store.sample && !store.settings.hide) {
      const pf = computePortfolio(store.assets, store.txs, store.prices);
      const av = pf.assets.reduce((sum, a) => (a.value ? sum.plus(a.value) : sum), Decimal.ZERO);
      worth = `${fmtNum(fromRial(netWorth(pf.cash, av, peopleWithCheques())))} ${unitLabel()}`;
    }
    toNative({ type: 'widget-config', widget: {
      keys, unit, showWorth: !!worth, worth,
      rows: live ? buildRows(m.entries, keys, unit) : [],
      updatedAt: t ? new Date(t + 3.5 * 3600e3).toISOString().slice(0, 19) : null,
    } });
  }, 800);
}

/* ============================ قالب‌بندی ============================ */

const isToman = () => store.settings.unit === 'toman';
const unitLabel = () => (isToman() ? 'تومان' : 'ریال');
const fromRial = (r: Decimal) => (isToman() ? r.div(10) : r);
const toRialDec = (v: Decimal) => (isToman() ? v.mul(10) : v);

const ltr = (s: string) => `<bdi dir="ltr" class="num">${s}</bdi>`;
const MASK = '<span class="num">••••••</span>';
const hidden = () => !!store.settings.hide;
/** قیمت‌های عمومی بازار (طلا، دلار، سهم…) به دارایی شخص ربطی ندارند؛ با پنهان‌کردن مبلغ‌ها پنهان نمی‌شوند */
const publicMoney = (rial: Decimal, unit = true) => ltr(fmtNum(fromRial(rial))) + (unit ? ` <span class="u">${unitLabel()}</span>` : '');
const money = (rial: Decimal, unit = true) =>
  (hidden() ? MASK : ltr(fmtNum(fromRial(rial)))) + (unit ? ` <span class="u">${unitLabel()}</span>` : '');

const EYE_ON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19c-6.4 0-10-7-10-7a18.7 18.7 0 0 1 5.1-5.9M9.9 5.2A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a18.5 18.5 0 0 1-2.2 3.2"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="M2 2l20 20"/></svg>';

function pnl(d: Decimal | null): string {
  if (d === null) return '<span class="muted">—</span>';
  if (d.isZero()) return `<span class="muted">${money(d)}</span>`;
  const loss = d.isNegative();
  const abs = loss ? d.neg() : d;
  return `<span class="${loss ? 'loss' : 'gain'}">${loss ? 'زیان' : 'سود'} ${money(abs)}</span>`;
}

const qty = (d: Decimal, a: Asset) => ltr(fmtNum(d, a.decimals)) + ` <span class="u">${esc(a.unit)}</span>`;
const dateFa = (iso: string) => ltr(toFa(formatJalali(iso)));
function stamp(iso: string): string {
  const dt = new Date(iso);
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${dateFa(todayIso(dt))} ${ltr(toFa(`${hh}:${mm}`))}`;
}

/** رشته‌ی ریالی ذخیره‌شده → متن قابل ویرایش در واحد نمایش */
function rialToField(r: string): string {
  const d = parseDec(r);
  if (!d) return '';
  const v = fromRial(d);
  return toFa(v.isInteger() ? v.toString() : v.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''));
}
function plainField(d: Decimal): string {
  return toFa(d.isInteger() ? d.toString() : d.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''));
}

function priceLabel(p: PriceEntry): string {
  if (p.source === 'manual') return `ورود دستی · ${stamp(p.at)}`;
  // زمان قیمت خودکار به وقت تهران و به‌صورت رشته ذخیره شده است
  const d = dateFa(p.at.slice(0, 10));
  const t = p.dateOnly ? '' : ' ' + ltr(toFa(p.at.slice(11, 16)));
  return `خودکار${p.provider ? ' (' + esc(p.provider.toUpperCase()) + ')' : ''} · ${d}${t}`;
}

/* ============================== نمای کلی ============================== */

const view = {
  tab: 'home' as Tab, assetId: null as string | null, search: '', filter: 'all' as string,
  person: null as string | null,
  market: false, mcat: 'all' as CategoryId | 'all', mq: '', mstale: false,
  historyRange: '1m' as '1d' | '1w' | '1m' | '3m' | '6m' | '1y' | 'all',
};

const assetById = (id: string) => store.assets.find((a) => a.id === id);
const assetName = (id: string) => (id === CASH_ID ? 'وجه نقد' : assetById(id)?.name ?? id);
const TYPE_LABEL: Record<TxType, string> = { buy: 'خرید', sell: 'فروش', receive: 'دریافت (هدیه)', deposit: 'واریز (حقوق، هدیه)', withdraw: 'برداشت' };

const ICONS: Record<Tab, string> = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  assets: '<circle cx="9" cy="12" r="6"/><path d="M15 6.3A6 6 0 1 1 15 17.7"/>',
  txs: '<path d="M7 4v16M7 20l-3-3M7 20l3-3"/><path d="M17 20V4M17 4l-3 3M17 4l3 3"/>',
  people: '<rect x="4" y="6" width="16" height="13" rx="2"/><path d="M4 10h16M8 15h4"/><path d="M18 4h3v13"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
};
const TAB_LABEL: Record<Tab, string> = {
  home: 'خانه', assets: 'دارایی‌ها', txs: 'معاملات', people: 'تعهدات', settings: 'تنظیمات',
};

function navHtml(): string {
  const tabs: Tab[] = ['home', 'assets', 'txs', 'people', 'settings'];
  return `<nav class="nav" aria-label="منوی اصلی"><div class="in">${tabs
    .map(
      (t) =>
        `<button data-action="tab" data-v="${t}" ${view.tab === t && !view.assetId ? 'aria-current="page"' : ''}>
          <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[t]}</svg><span>${TAB_LABEL[t]}</span></button>`,
    )
    .join('')}</div></nav>`;
}

/** تازه‌ترین زمان قیمت: بیشینه‌ی زمان نمای بازار و قیمت‌های خودکار دارایی‌ها (به وقت تهران) */
function lastPriceMs(): number {
  let t = 0;
  try { t = snapshotTime(mk().entries); } catch { t = 0; }
  for (const p of Object.values(store.prices)) {
    if (p.source !== 'auto') continue;
    const ms = Date.parse(p.at);
    if (Number.isFinite(ms) && ms > t) t = ms;
  }
  return t;
}

function lastPriceLabel(): string {
  const t = lastPriceMs();
  if (!t) return 'قیمتی ثبت نشده';
  const d = new Date(t);
  let time = '';
  let day = '';
  try {
    time = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false });
    day = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
  } catch {
    time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    day = todayIso(d);
  }
  const when = ltr(toFa(time));
  return day === todayIso() ? `آخرین قیمت: امروز ساعت ${when}` : `آخرین قیمت: ${dateFa(day)} ساعت ${when}`;
}

function header(title: string, sub = ''): string {
  const n = remBadge();
  const bell = `<button class="bell" data-action="rem-open" aria-label="یادآورها${n ? ' (' + toFa(String(n)) + ' مورد)' : ''}">${BELL}${n ? `<b class="bd">${toFa(String(n))}</b>` : ''}</button>`;
  return `<header class="top"><div class="ttl"><h1>${title}</h1>${bell}</div><span class="date"><span>${sub || 'امروز ' + dateFa(todayIso())}</span><small class="pt" data-testid="price-time">${lastPriceLabel()}</small></span></header>`;
}

function sampleNote(): string {
  if (!store.sample) return '';
  return `<div class="note"><span><b>داده‌ی آزمایشی.</b> اعداد این صفحه نمونه‌اند و فقط برای امتحان کردن برنامه ساخته شده‌اند. اطلاعات مالی واقعی را در این نسخه وارد نکنید.</span>
    <button class="btn link" data-action="start-empty">شروع با داده‌ی خالی</button></div>`;
}

/* -------------------------------- خانه -------------------------------- */

/** درصد با یک رقم اعشار و ارقام فارسی */
function pctText(p: number): string {
  if (p > 0 && p < 0.05) return 'کمتر از ۰٫۱٪';
  return toFa(p.toFixed(1)).replace('.', '٫') + '٪';
}

const RANGES: [string, string][] = [['1d', '۱ روز'], ['1w', '۱ هفته'], ['1m', '۱ ماه'], ['3m', '۳ ماه'], ['6m', '۶ ماه'], ['1y', '۱ سال'], ['all', 'همه']];

/** نمودار کوچک روند سرمایه برای داخل کارت اصلی خانه */
/** نقاط نمودار روند که الان روی صفحه است (برای انتخاب با لمس) */
let sparkPts: { at: string; value: string }[] = [];

function sparkSelect(svg: SVGSVGElement, clientX: number) {
  const n = sparkPts.length;
  if (n < 2) return;
  const r = svg.getBoundingClientRect();
  if (!r.width) return;
  const vx = ((clientX - r.left) / r.width) * 320;
  const i = Math.max(0, Math.min(n - 1, Math.round(((vx - 6) / 308) * (n - 1))));
  const vals = sparkPts.map((p) => Number(p.value));
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || Math.max(Math.abs(max) * 0.02, 1);
  const x = 6 + (i / (n - 1)) * 308;
  const y = 46 - ((vals[i] - min) / span) * 38;
  const line = document.getElementById('sp-line');
  const dot = document.getElementById('sp-dot');
  if (line) { line.setAttribute('x1', x.toFixed(1)); line.setAttribute('x2', x.toFixed(1)); line.setAttribute('visibility', 'visible'); }
  if (dot) { dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', y.toFixed(1)); dot.setAttribute('visibility', 'visible'); }
  const cur = Decimal.parse(sparkPts[i].value);
  let txt = `<b>${stamp(sparkPts[i].at)}</b> · سرمایه <b>${money(cur)}</b>`;
  if (i > 0) {
    const prev = Decimal.parse(sparkPts[i - 1].value);
    const d = cur.minus(prev);
    const pct = prev.isZero() ? '' : ` ${signedPct(d.div(prev))}`;
    txt += `<br>تغییر نسبت به نقطه‌ی قبل: <span class="${d.gt(0) ? 'gain' : d.isNegative() ? 'loss' : ''}">${d.gt(0) ? '+' : ''}${money(d)}</span>${pct}`;
    const first = Decimal.parse(sparkPts[0].value);
    if (!first.isZero() && i > 1) txt += `<br>تغییر نسبت به ابتدای بازه: ${signedPct(cur.minus(first).div(first))}`;
  } else txt += '<br>ابتدای بازه';
  const read = document.getElementById('sp-read');
  if (read) read.innerHTML = txt;
}

function sparkHtml(): string {
  const all = store.history ?? [];
  const days: Record<string, number> = { '1d': 1, '1w': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365 };
  const cutoff = days[view.historyRange] ? Date.now() - days[view.historyRange] * 86400000 : 0;
  const points = all.filter((p) => Date.parse(p.at) >= cutoff && Number.isFinite(Number(p.value)));
  const chips = RANGES.map(([k, l]) => `<button class="rg" data-action="history-range" data-v="${k}" aria-pressed="${view.historyRange === k}">${l}</button>`).join('');
  if (points.length < 2) {
    return `<div class="spark"><div class="spark-empty">هنوز تاریخچه‌ی واقعی ثبت نشده است. با ثبت تراکنش‌ها و قیمت‌ها، روند دارایی شما از همین زمان شکل می‌گیرد.</div><div class="rgs">${chips}</div></div>`;
  }
  const first = Decimal.parse(points[0].value);
  const last = Decimal.parse(points[points.length - 1].value);
  const delta = last.minus(first);
  const change = first.isZero() ? null : delta.div(first).mul(100).toNumber();
  const min = Math.min(...points.map((p) => Number(p.value)));
  const max = Math.max(...points.map((p) => Number(p.value)));
  const span = max - min || Math.max(Math.abs(max) * 0.02, 1);
  const sampled = points.length > 120 ? points.filter((_, i) => i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 118) === 0) : points;
  sparkPts = sampled.map((p) => ({ at: p.at, value: p.value }));
  const coords = sampled.map((p, i) => ({ x: 6 + (i / Math.max(1, sampled.length - 1)) * 308, y: 46 - ((Number(p.value) - min) / span) * 38 }));
  const line = coords.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)} 54 L${coords[0].x.toFixed(1)} 54 Z`;
  const up = !delta.isNegative();
  const lbl = change === null ? '—' : `${change > 0 ? '+' : ''}${toFa(change.toFixed(1)).replace('.', '٫')}٪`;
  return `<div class="spark">
    <div class="spark-top"><span class="spark-t">روند سرمایه · ${dateFa(points[0].at.slice(0, 10))} تا ${dateFa(points[points.length - 1].at.slice(0, 10))}</span><b class="${up ? 'up' : 'down'}">${ltr(lbl)}</b></div>
    <svg viewBox="0 0 320 56" class="spark-svg" role="img" aria-label="نمودار روند ارزش سرمایه؛ برای دیدن مقدار هر نقطه روی آن بزنید یا انگشت را بکشید"><defs><linearGradient id="sp-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6fe7e0" stop-opacity=".35"/><stop offset="1" stop-color="#6fe7e0" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#sp-fill)"/><path d="${line}" fill="none" stroke="#6fe7e0" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${coords[coords.length - 1].x.toFixed(1)}" cy="${coords[coords.length - 1].y.toFixed(1)}" r="3.4" fill="#6fe7e0"/>
    <line id="sp-line" x1="0" x2="0" y1="2" y2="54" stroke="#fff" stroke-opacity=".55" stroke-width="1" visibility="hidden"/><circle id="sp-dot" r="4" fill="#fff" stroke="#6fe7e0" stroke-width="2" visibility="hidden"/></svg>
    <div class="spark-read" id="sp-read" aria-live="polite">روی نمودار بزنید یا انگشت را بکشید تا هر تغییر را ببینید.</div>
    <div class="rgs">${chips}</div></div>`;
}

/** تب «دارایی‌ها»: یک فهرست واحد با سهم هر مورد از کل سرمایه (بدون تکرار) */
/** طلب و بدهی اشخاص + چک‌های باز؛ برای سرمایه‌ی خالص */
function peopleWithCheques() {
  const ppl = computePeople(peopleData(), todayIso());
  const ck = chequeTotals(store.cheques ?? []);
  return { ...ppl, receivable: ppl.receivable.plus(ck.receivable), payable: ppl.payable.plus(ck.payable) };
}

function assetsOverview(pf: Portfolio, ppl: { receivable: Decimal; payable: Decimal }): string {
  interface Row { key: string; label: string; value: Decimal | null; icon: string; sub: string; extra: string; open?: string }
  const rows: Row[] = [{ key: 'cash', label: 'وجه نقد', value: pf.cash, icon: `<span class="ico sm">${iconSvg({ t: 'cash' })}</span>`, sub: 'جدا از دارایی‌ها', extra: '' }];
  for (const a of pf.assets) {
    rows.push({
      key: a.asset.id, label: a.asset.name, value: a.value,
      icon: `<span class="ico sm">${iconSvg(iconKind(a.asset))}</span>`,
      sub: qty(a.state.quantity, a.asset),
      extra: a.value ? pnl(a.unrealized) + (a.unrealized && a.state.costBasis.gt(0) ? ' ' + signedPct(a.unrealized.div(a.state.costBasis)) : '') : '',
      open: a.asset.id,
    });
  }
  if (ppl.receivable.gt(0)) rows.push({ key: 'recv', label: 'طلب‌ها', value: ppl.receivable, icon: `<span class="ico sm">${iconSvg({ t: 'people' })}</span>`, sub: 'اشخاص و چک‌ها', extra: '' });
  const total = rows.reduce((t, r) => (r.value && r.value.gt(0) ? t.plus(r.value) : t), Decimal.ZERO);
  // رنگ بر اساس هویت (ترتیب ثابت)، نه رتبه
  const order = ['cash', ...store.assets.map((a) => a.id), 'recv'];
  const sorted = [...rows].sort((a, b) => (b.value?.gt(0) ? 1 : 0) - (a.value?.gt(0) ? 1 : 0) || (b.value ?? Decimal.ZERO).cmp(a.value ?? Decimal.ZERO));
  const list = sorted
    .map((r) => {
      const frac = r.value && r.value.gt(0) && total.gt(0) ? r.value.div(total).toNumber() * 100 : 0;
      const color = `var(--c${(order.indexOf(r.key) % 8) + 1})`;
      const valueText = r.value ? `${money(r.value)}${r.extra ? ' · ' + r.extra : ''}` : '<span class="muted">قیمت روز ثبت نشده</span>';
      const inner = `<div class="ah"><span class="nm">${r.icon}<span class="tx">${esc(r.label)}</span></span><span class="pc">${r.value && r.value.gt(0) ? pctText(frac) : '—'}</span></div>
        <div class="track" role="img" aria-label="${esc(r.label)}: ${pctText(frac)}"><i style="width:${frac > 0 ? Math.max(frac, 1).toFixed(2) : '0'}%;background:${color}"></i></div>
        <div class="am"><span>${r.sub}</span><span>${valueText}</span></div>`;
      return r.open
        ? `<button class="ab ab-btn" data-action="open-asset" data-v="${esc(r.open)}">${inner}</button>`
        : `<div class="ab">${inner}</div>`;
    })
    .join('');
  const debtNote = ppl.payable.gt(0) && total.gt(0)
    ? `<div class="hint">بدهی‌های شما (${money(ppl.payable)}) در این درصدها نیست؛ معادل ${pctText(ppl.payable.div(total).toNumber() * 100)} از جمع بالاست.</div>`
    : '';
  const missing = pf.missingPrice.length
    ? `<div class="hint">برای ${toFa(String(pf.missingPrice.length))} دارایی قیمت روز ثبت نشده و در درصدها نیامده است.</div>`
    : '';
  return `<section class="alloc" aria-label="دارایی‌ها و سهم هرکدام از سرمایه">${list}</section>${debtNote}${missing}
    <div class="hint">سرمایه‌ی خالص = نقد + (مقدار هر دارایی × قیمت روز) + طلب‌ها − بدهی‌ها</div>`;
}

function stockSearchHtml(f: AssetForm): string {
  const hits = f.hits
    .map((h, i) => `<button class="row" data-action="stock-pick" data-v="${i}"><div class="main"><span class="t">${esc(h.symbol)}</span><span class="s">${esc(h.name)}</span></div></button>`)
    .join('');
  return `<h2 class="section-title"><span>اتصال به بورس (قیمت خودکار)</span></h2>
    ${inApp() ? '' : '<div class="note warn"><span>جست‌وجوی خودکار فقط در اپ اندروید کار می‌کند. در این نسخه‌ی آزمایشی می‌توانید کد نماد را دستی وارد کنید.</span></div>'}
    <div class="field"><label for="a-q">نام نماد را بنویسید (مثلاً فملی)</label>
      <div class="inline"><input id="a-q" data-field="q" value="${esc(f.q)}" autocomplete="off">
      <button class="btn small" data-action="stock-search" ${f.busy ? 'disabled' : ''}>${f.busy ? 'در حال جست‌وجو…' : 'جست‌وجو'}</button></div></div>
    ${hits ? `<div class="list">${hits}</div>` : ''}
    <div class="field"><label for="a-ins">کد نماد در TSETMC (خودکار پر می‌شود)</label>
      <div class="inline"><input id="a-ins" data-field="insCode" inputmode="numeric" value="${esc(f.insCode)}" autocomplete="off">
      <button class="btn small ghost" data-action="stock-test" ${f.busy ? 'disabled' : ''}>قیمت آزمایشی</button></div>
      <span class="hint" dir="auto" style="user-select:text;word-break:break-word">${f.preview ? esc(f.preview) : 'با «قیمت آزمایشی» آخرین قیمت را ببینید و با سایت بورس مقایسه کنید.'}</span></div>`;
}

/** قیمت آزمایشی نماد برای تطبیق با سایت بورس؛ هیچ قیمتی ذخیره نمی‌شود */
/** پاسخ سرور بورس را می‌خواند؛ اگر خطا یا قالب ناشناخته بود، ابتدای متن واقعی پاسخ را در پیام می‌آورد تا علت دیده شود */
const isWebOnly = () => !(window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView;
const WEB_BLOCKED =
  'مرورگر اجازه‌ی خواندن مستقیم قیمت بورس را نداد (محدودیت خودِ سایت بورس). در نسخه‌ی وب، قیمت سهم را دستی وارد کنید؛ اپ اندروید آن را خودکار می‌گیرد.';

/** برای بورس در نسخه‌ی وب: اگر مرورگر درخواست را مسدود کرد، پیام روشن و فارسی بده */
function tsetmcFetch(url: string) {
  return Promise.resolve(nativeFetch(url)).catch((e: unknown) => {
    if (isWebOnly() && e instanceof TypeError) throw new Error(WEB_BLOCKED);
    throw e;
  });
}

async function tsetmcCall<T>(url: string, parse: (raw: string) => T): Promise<T> {
  const res = await tsetmcFetch(url);
  const raw = await res.text();
  const snip = raw.replace(/\s+/g, ' ').slice(0, 220) || '(پاسخ خالی)';
  if (!res.ok) throw new Error(`پاسخ نامعتبر از سرور بورس (کد ${res.status}). متن پاسخ: ${snip}`);
  try {
    return parse(raw);
  } catch (e) {
    throw new Error(`${e instanceof Error ? e.message : 'خطا'} متن پاسخ: ${snip}`);
  }
}

async function stockPreview(f: AssetForm) {
  if (!isInsCode(f.insCode)) {
    f.preview = 'کد نماد معتبر نیست (فقط رقم).';
    renderModal();
    return;
  }
  f.busy = true;
  f.preview = '';
  renderModal();
  try {
    const q = await tsetmcCall(quoteUrl(f.insCode), (raw) => parseClosingInfo(raw, f.insCode));
    f.preview = `آخرین معامله: ${fmtNum(fromRial(q.price))} ${unitLabel()} — ${formatJalali(q.at.slice(0, 10))} ساعت ${q.at.slice(11, 16)}`;
  } catch (e) {
    f.preview = e instanceof Error ? e.message : 'دریافت قیمت انجام نشد.';
  }
  f.busy = false;
  if (modal?.kind === 'asset' && modal.f === f) renderModal();
}

async function runStockSearch(f: AssetForm) {
  if (!f.q.trim()) return setErr('نام نماد را بنویسید.');
  if (!inApp()) return setErr('جست‌وجوی خودکار فقط در اپ اندروید کار می‌کند؛ کد نماد را دستی وارد کنید.');
  f.busy = true;
  f.error = '';
  renderModal();
  try {
    f.hits = (await tsetmcCall(searchUrl(f.q), parseSearch)).slice(0, 8);
    if (f.hits.length === 0) f.error = 'نمادی با این نام پیدا نشد.';
  } catch (e) {
    f.error = e instanceof Error ? e.message : 'جست‌وجو انجام نشد.';
  }
  f.busy = false;
  if (modal?.kind === 'asset' && modal.f === f) renderModal();
}

function viewHome(pf: Portfolio): string {
  const assetsValue = pf.assets.reduce((s, a) => (a.value ? s.plus(a.value) : s), Decimal.ZERO);
  const ppl = peopleWithCheques();
  const worth = netWorth(pf.cash, assetsValue, ppl);
  const missing = pf.missingPrice.map((id) => esc(assetName(id)));

  return `${header('دارا', 'مدیریت دارایی‌های شخصی')}
    ${sampleNote()}
    <section class="hero compact" aria-label="خلاصه‌ی دارایی">
      <div class="between"><span class="label">سرمایه‌ی خالص</span>
        <button class="eye" data-action="toggle-hide" aria-pressed="${hidden()}" aria-label="${hidden() ? 'نمایش مبلغ‌ها' : 'پنهان کردن مبلغ‌ها'}">${hidden() ? EYE_OFF : EYE_ON}</button></div>
      <div class="big">${hidden() ? MASK : ltr(fmtNum(fromRial(worth)))}<span class="u">${unitLabel()}</span></div>
      <div class="mini"><span>نقد <b>${money(pf.cash, false)}</b></span><span>دارایی‌ها <b>${money(assetsValue, false)}</b></span><span>طلب‌ها و چک <b>${money(ppl.receivable, false)}</b></span><span>بدهی‌ها و چک <b>${money(ppl.payable, false)}</b></span></div>
      ${sparkHtml()}
    </section>
    ${
      missing.length
        ? `<div class="note"><span>قیمت روز ${missing.join('، ')} ثبت نشده است، پس مجموع بالا ناقص است.</span>
           <button class="btn link" data-action="price" data-v="${esc(pf.missingPrice[0])}">ثبت قیمت روز</button></div>`
        : ''
    }
    ${
      backupDue()
        ? `<div class="note"><span>${store.settings.lastBackup ? 'پشتیبان شما قدیمی است.' : 'هنوز از اطلاعات پشتیبان نگرفته‌اید.'} با عوض شدن گوشی یا پاک شدن برنامه، اطلاعات از بین می‌رود.</span><button class="btn" data-action="backup-open">پشتیبان‌گیری</button></div>`
        : ''
    }
    ${marketSection()}
    ${incomeTile()}
    <div class="grid2">
      <div class="tile"><span class="k">سود یا زیان فروش‌ها (تحقق‌یافته)</span><span class="v">${pnl(pf.realizedTotal)}</span></div>
      <div class="tile"><span class="k">سود یا زیان دارایی‌های فعلی</span><span class="v">${pnl(pf.unrealizedTotal)}</span></div>
    </div>
    <div class="actions">
      <button class="btn" data-action="new-tx" data-asset="" data-type="buy">ثبت خرید</button>
      <button class="btn" data-action="new-tx" data-asset="" data-type="sell">ثبت فروش</button>
      <button class="btn ghost" data-action="new-tx" data-asset="${CASH_ID}" data-type="deposit">واریز نقد</button>
      <button class="btn ghost" data-action="income-new">ثبت سود دریافتی</button>
      <button class="btn ghost" data-action="report-open">گزارش ماهانه و خروجی Excel</button>
    </div>
    ${
      inApp() && upd.status === 'available'
        ? '<div class="note info"><span>نسخه‌ی جدید برنامه آماده است.</span><button class="btn" data-action="update-install">دانلود و نصب</button></div>'
        : ''
    }`;
}

const ALLOC_COLOR: Record<AllocId, string> = {
  cash: 'var(--c1)', gold: 'var(--c4)', currency: 'var(--c3)', stock: 'var(--c2)', crypto: 'var(--c5)', other: 'var(--c-other)',
};

function allocationCard(pf: Portfolio): string {
  const a = computeAllocation(pf);
  if (a.slices.length === 0) return '';
  const R = 15.9155; // محیط ۱۰۰ ⇒ طول هر برش برابر درصدش
  let off = 25; // از بالا شروع می‌شود
  const arcs = a.slices.map((sl) => {
    const gap = a.slices.length > 1 ? Math.min(0.8, sl.pct / 2) : 0; // فاصله‌ی ۲ پیکسلی میان برش‌ها
    const el = `<circle cx="20" cy="20" r="${R}" fill="none" stroke="${ALLOC_COLOR[sl.id]}" stroke-width="6" stroke-dasharray="${(sl.pct - gap).toFixed(3)} ${(100 - sl.pct + gap).toFixed(3)}" stroke-dashoffset="${off.toFixed(3)}"/>`;
    off -= sl.pct;
    return el;
  }).join('');
  const pctTxt = (p: number) => ltr(toFa(p < 0.1 ? '<۰٫۱' : p.toFixed(1).replace(/\.0$/, '')).replace('.', '٫') + '٪');
  const rows = a.slices.map((sl) => `<li><span class="sw" style="background:${ALLOC_COLOR[sl.id]}"></span><span class="nm">${sl.label}</span>
      <span class="pc">${pctTxt(sl.pct)}</span><span class="am">${hidden() ? MASK : money(sl.value, false)}</span></li>`).join('');
  return `<section class="tile alloc" aria-label="ترکیب دارایی‌ها">
    <h2 class="section-title">ترکیب دارایی‌ها</h2>
    <div class="allocwrap">
      <svg viewBox="0 0 40 40" class="donut" role="img" aria-label="${a.slices.map((x) => `${x.label} ${x.pct.toFixed(0)} درصد`).join('، ')}">
        <circle cx="20" cy="20" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="6"/>${arcs}</svg>
      <ul class="alloclist">${rows}</ul>
    </div>
    ${a.unpriced.length ? `<span class="hint">دارایی‌های بدون قیمت روز در این نمودار نیستند.</span>` : ''}
  </section>`;
}

function incomeTile(): string {
  const to = todayIso();
  const t = incomeTotals(store.txs, addDaysIso(to, -365), to);
  if (t.total.lte(0)) return '';
  const part = (label: string, v: Decimal) => (v.gt(0) ? `<span>${label} <b>${money(v, false)}</b></span>` : '');
  return `<div class="tile"><span class="k">سود دریافتی در ۳۶۵ روز اخیر</span>
    <span class="v">${hidden() ? MASK : money(t.total)}</span>
    <div class="mini">${part('سود سهام', t.dividend)}${part('سود سپرده', t.deposit)}${part('سود روزشمار', t.accrual)}</div></div>`;
}

/* ------------------------------ گزارش خانواده ------------------------------ */

function familyText(o: FamilyOpts): string {
  const today = todayIso();
  const pf = computePortfolio(store.assets, store.txs, store.prices);
  const assetsValue = pf.assets.reduce((sum, a) => (a.value ? sum.plus(a.value) : sum), Decimal.ZERO);
  const worth = netWorth(pf.cash, assetsValue, peopleWithCheques());
  const items: FamilyItem[] = [];
  for (const e of installmentEvents(store.debts, store.payments, personNameOf, remSettings(), today, 30)) {
    if (e.kind !== 'installment' || !e.amount) continue;
    const debt = store.debts.find((d) => e.id.startsWith(`inst:${d.id}:`));
    items.push({ kind: debt?.direction === 'lent' ? 'installment-in' : 'installment-out', label: e.title, due: e.dueDate, amount: Decimal.of(e.amount) });
  }
  for (const c of store.cheques ?? []) {
    if (!chequeOutstanding(c)) continue;
    items.push({ kind: c.direction === 'received' ? 'cheque-in' : 'cheque-out', label: `چک ${c.accountHolder}`, due: c.dueDate, amount: Decimal.of(c.amount) });
  }
  return toFa(familyReportText({
    dateLabel: toFa(formatJalali(today)), worth, alloc: computeAllocation(pf), items, today,
    fmtMoney: (d) => `${fmtNum(fromRial(d))} ${unitLabel()}`, fmtDate: (iso) => toFa(formatJalali(iso)), opts: o,
  }));
}

/* ------------------------------ سود واقعی ------------------------------ */

function signedPct(r: Decimal): string {
  const n = Number(r.mul(100).toFixed(1));
  const txt = ltr((n > 0 ? '+' : n < 0 ? '−' : '') + toFa(Math.abs(n).toFixed(1)).replace('.', '٫') + '٪');
  return `<b class="${n > 0 ? 'gain' : n < 0 ? 'loss' : ''}">${txt}</b>`;
}

function benchRow(label: string, b: Bench | null, none: string): string {
  if (!b) return `<div class="between rr"><span>${label}</span><span class="muted">${none}</span></div>`;
  const cov = b.coverage < 0.995 ? ` <span class="muted">(${toFa(String(Math.round(b.coverage * 100)))}٪ خریدها)</span>` : '';
  return `<div class="between rr"><span>${label}${cov}</span><span>${signedPct(b.real)}</span></div>`;
}

function realReturnCard(): string {
  if (store.sample) return '';
  const infl = typeof store.settings.inflation === 'number' ? store.settings.inflation : null;
  const r = computeRealReturn(store.assets.map((a) => a.id), store.txs, store.prices, store.priceLog ?? {}, todayIso(), infl);
  if (!r) return '';
  return `<section class="tile rrcard" aria-label="سود واقعی">
    <h2 class="section-title">سود واقعی دارایی‌ها</h2>
    <div class="between rr"><span>سود اسمی (نسبت به قیمت خرید)</span><span>${signedPct(r.nominal)}</span></div>
    ${benchRow('نسبت به نگه‌داشتن دلار', r.usd, 'قیمت دلار برای تاریخ خریدها ثبت نشده')}
    ${benchRow('نسبت به نگه‌داشتن طلا', r.gold, 'قیمت طلا برای تاریخ خریدها ثبت نشده')}
    ${benchRow('نسبت به تورم', r.inflation, infl === null ? 'نرخ تورم وارد نشده' : '—')}
    <span class="hint">مثبت یعنی بهتر از آن مرجع عمل کرده‌اید. قیمت دلار و طلا از زمان نصب هر روز که قیمت خودکار می‌آید ثبت می‌شود و قیمت تاریخی ساخته نمی‌شود؛ هر خریدی که قیمت مرجع نزدیکش (تا ۳۰ روز) نداشته باشد در آن مقایسه نمی‌آید. تورم تخمینی و بر پایه‌ی نرخ دستی شماست.</span>
    <div class="actions"><button class="btn ghost" data-action="infl-open">${infl === null ? 'وارد کردن نرخ تورم' : `نرخ تورم: ${toFa(String(infl))}٪ (تغییر)`}</button></div>
  </section>`;
}

/* ------------------------------ نمای بازار ------------------------------ */

type EntryMeta = ReturnType<typeof classify>;
function fmtVal(meta: EntryMeta, s: string): string {
  let d: Decimal;
  try {
    d = Decimal.parse(s);
  } catch {
    return '—';
  }
  if (meta.unit === 'irr') return publicMoney(d);
  if (meta.unit === 'usd') return ltr(fmtNum(d, 4)) + ' <span class="u">دلار</span>';
  return ltr(fmtNum(d, 4));
}

function changeHtml(e: MarketEntry): string {
  let hasAmount = false;
  try {
    hasAmount = !!e.change && !Decimal.parse(e.change).isZero();
  } catch {
    hasAmount = false;
  }
  if (!e.dir || (e.changePct === 0 && !hasAmount)) return '<span class="muted">—</span>';
  const up = e.dir === 'up';
  // درصد زیر ۰٫۰۱ در منبع صفر گرد می‌شود؛ جهت و مبلغ تغییر را پنهان نمی‌کنیم
  const pct = e.changePct > 0 ? `${toFa(e.changePct.toFixed(2).replace(/\.?0+$/, '').replace('.', '٫'))}٪` : 'کمتر از ۰٫۰۱٪';
  return `<span class="${up ? 'gain' : 'loss'}">${up ? '▲' : '▼'} ${ltr(pct)}</span>`;
}

function entryTime(e: MarketEntry): string {
  const date = e.at.slice(0, 10);
  if (e.dateOnly) return dateFa(date);
  const t = ltr(toFa(e.at.slice(11, 16)));
  return date === todayIso() ? t : `${dateFa(date)} ${t}`;
}

const favKeys = (): string[] => store.settings.favs ?? [...PREVIEW_KEYS];

function quoteRow(e: MarketEntry, now: number): string {
  const meta = classify(e.key);
  const stale = isStale(e, now);
  const keyHint = meta.named ? `<bdi dir="ltr">${esc(e.key)}</bdi> · ` : '';
  const fav = favKeys().includes(e.key);
  return `<div class="row market-row${stale ? ' dim' : ''}">
    <button class="star" data-action="fav" data-v="${esc(e.key)}" aria-pressed="${fav}" aria-label="${fav ? 'حذف از منتخب‌های خانه' : 'افزودن به منتخب‌های خانه'}">${fav ? '★' : '☆'}</button>
    <button class="mr-main" data-action="quote" data-v="${esc(e.key)}">
      <span class="market-ico">${marketIcon(e.key, meta.category, meta.title)}</span>
      <div class="main"><span class="t">${esc(meta.title)}${stale ? ' <span class="badge">قدیمی</span>' : ''}</span>
        <span class="s">${keyHint}${entryTime(e)}${meta.per ? ' · ' + esc(meta.per) : ''}</span></div>
      <div class="side"><span class="t">${fmtVal(meta, e.price)}</span><span class="s">${changeHtml(e)}</span></div></button></div>`;
}

/** کهنگی قیمت‌ها در نمای بازار نسبت به تازه‌ترین قیمتِ همان فهرست سنجیده می‌شود؛ عمر کل فهرست جدا اعلام می‌شود */
const marketRef = () => snapshotTime(mk().entries);

function ageText(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'چند دقیقه پیش';
  if (h < 48) return `حدود ${toFa(String(h))} ساعت پیش`;
  return `${toFa(String(Math.floor(h / 24)))} روز پیش`;
}

function marketNote(): string {
  const snap = mk();
  const t = snapshotTime(snap.entries);
  const old = Date.now() - t > 6 * 3_600_000;
  const src = snap.source === 'tgju' ? 'TGJU' : snap.source === 'pasted' ? 'پاسخ چسبانده‌شده از TGJU' : 'نمونه‌ی ذخیره‌شده‌ی TGJU';
  return `<div class="note ${old ? '' : 'info'}"><span>منبع: ${src} · زمان داده: ${stamp(new Date(t).toISOString())}${
    old ? `<br><b>این فهرست مال ${ageText(Date.now() - t)} است.</b> برای قیمت امروز به‌روزرسانی کنید.` : ''
  }</span></div>`;
}

const PREVIEW_KEYS = ['geram18', 'price_dollar_rl', 'crypto-tether-irr', 'sekee', 'mesghal', 'ons', 'crypto-bitcoin'];

function marketSection(): string {
  const now = marketRef();
  const by = new Map(mk().entries.map((e) => [e.key, e]));
  const rows = favKeys().map((k) => by.get(k))
    .filter((e): e is MarketEntry => !!e)
    .map((e) => quoteRow(e, now))
    .join('');
  const empty = favKeys().length
    ? '<div class="empty">قیمت موارد انتخابی در فهرست فعلی نیست. «به‌روزرسانی» را بزنید.</div>'
    : '<div class="empty">هنوز موردی انتخاب نکرده‌اید. «انتخاب و همه‌ی قیمت‌ها» را بزنید و ستاره‌ی هر قیمت را روشن کنید.</div>';
  return `<h2 class="section-title"><span>نمای بازار</span><button class="btn small ghost" data-action="market-open">انتخاب و همه‌ی قیمت‌ها</button></h2>
    ${marketNote()}
    <div class="list">${rows || empty}</div>`;
}

const MARKET_LIMIT = 150;
function marketBody(): { html: string; count: string } {
  const now = marketRef();
  const res = searchMarket(mk().entries, { text: view.mq, category: view.mcat, includeStale: view.mstale, now });
  const shown = res.slice(0, MARKET_LIMIT);
  const count = res.length > shown.length
    ? `${toFa(String(shown.length))} مورد از ${toFa(String(res.length))} (برای دیدن بقیه جست‌وجو را دقیق‌تر کنید)`
    : `${toFa(String(res.length))} مورد`;
  return {
    html: shown.length ? shown.map((e) => quoteRow(e, now)).join('') : '<div class="empty">چیزی پیدا نشد.</div>',
    count,
  };
}

function viewMarket(): string {
  const chips: [string, string][] = [['all', 'همه'], ...CATEGORIES.map((c): [string, string] => [c.id, c.label])];
  const body = marketBody();
  return `<div class="top"><button class="back" data-action="back">← خانه</button></div>
    ${header('نمای بازار')}
    ${marketNote()}
    <div class="actions"><button class="btn" data-action="refresh">به‌روزرسانی قیمت‌ها</button>
      <button class="btn ghost" data-action="paste-open">چسباندن پاسخ TGJU</button></div>
    <div class="field"><label for="msearch">جست‌وجو (نام فارسی یا کلید)</label>
      <input id="msearch" type="search" value="${esc(view.mq)}" autocomplete="off"></div>
    <div class="chips" role="group" aria-label="دسته">${chips
      .map(([k, l]) => `<button class="chip" data-action="mcat" data-v="${k}" aria-pressed="${view.mcat === k}">${l}</button>`)
      .join('')}<button class="chip" data-action="mstale" aria-pressed="${view.mstale}">نمایش قیمت‌های قدیمی</button></div>
    <div class="note info"><span>ستاره‌ی هر قیمت را روشن کنید تا در صفحه‌ی خانه نمایش داده شود.</span></div>
    <div class="muted" id="mcount">${body.count}</div>
    <div class="list" id="mlist">${body.html}</div>
    <div class="note info"><span>نام و واحد فقط برای مواردی نوشته شده که از کلید و بزرگی عدد مطمئن‌ایم. بقیه با کلید اصلی و بدون واحد نمایش داده می‌شوند. قیمت‌هایی که از تازه‌ترین قیمت فهرست بیش از ۶ ساعت (یا ۴ روز برای قیمت‌های روزانه) عقب‌ترند پنهان‌اند.</span></div>`;
}

/* ------------------------------ دارایی‌ها ------------------------------ */

/** سود و زیان کل دارایی‌های دارای قیمت، با درصد نسبت به بهای خرید موجودی */
function pnlSummary(pf: Portfolio): string {
  let cost = Decimal.ZERO;
  for (const a of pf.assets) if (a.value !== null && a.state.quantity.gt(0)) cost = cost.plus(a.state.costBasis);
  if (cost.lte(0)) return '';
  const pct = signedPct(pf.unrealizedTotal.div(cost));
  return `<div class="grid2">
    <div class="tile"><span class="k">سود یا زیان کل دارایی‌های فعلی</span><span class="v">${pnl(pf.unrealizedTotal)} ${pct}</span><span class="k">نسبت به بهای خرید موجودی</span></div>
    <div class="tile"><span class="k">سود یا زیان فروش‌ها</span><span class="v">${pnl(pf.realizedTotal)}</span></div>
  </div>`;
}

function viewAssets(pf: Portfolio): string {
  const ppl = peopleWithCheques();
  return `${header('دارایی‌ها')}
    ${allocationCard(pf)}
    <h2 class="section-title"><span>سهم هر دارایی و سرمایه‌ها</span></h2>
    ${assetsOverview(pf, ppl)}
    ${realReturnCard()}
    ${pnlSummary(pf)}
    <div class="actions">
      <button class="btn" data-action="add-asset">افزودن دارایی</button>
      <button class="btn ghost" data-action="refresh">به‌روزرسانی قیمت‌ها</button>
      <button class="btn ghost" data-action="new-tx" data-asset="${CASH_ID}" data-type="deposit">واریز یا برداشت نقد</button>
    </div>`;
}

function viewAssetDetail(id: string, pf: Portfolio): string {
  const sum = pf.assets.find((a) => a.asset.id === id);
  if (!sum) return viewAssets(pf);
  const { asset, state, price, value, unrealized } = sum;
  const history = [...state.rows].reverse();
  const hist = history.length
    ? history
        .map((r) => {
          const tx = store.txs.find((t) => t.id === r.txId);
          return `<div class="row"><div class="main"><span class="t"><span class="badge ${r.type}">${TYPE_LABEL[r.type]}</span> ${qty(r.quantity, asset)}</span>
            <span class="s">${dateFa(r.date)} · قیمت واحد ${money(r.unitPrice)}${tx?.note ? ' · ' + esc(tx.note) : ''}</span></div>
            <div class="side"><span class="t">${money(r.total)}</span>${r.realizedPnl ? `<span class="s">${pnl(r.realizedPnl)}</span>` : ''}</div></div>`;
        })
        .join('')
    : `<div class="empty">هنوز معامله‌ای برای این دارایی ثبت نشده است.</div>`;
  const priceTile = price
    ? `<span class="v">${publicMoney(parseDec(price.price) as Decimal)}</span>
       <span class="k">${priceLabel(price)}</span>`
    : `<span class="v muted">ثبت نشده</span><span class="k">هیچ قیمتی حدس زده نمی‌شود</span>`;
  return `<div class="top"><button class="back" data-action="back">← دارایی‌ها</button></div>
    <section class="hero">
      <span class="label" style="display:flex;align-items:center;gap:.6rem">${assetIcon(asset)}${esc(asset.name)}</span>
      <div class="big">${ltr(fmtNum(state.quantity, asset.decimals))}<span class="u">${esc(asset.unit)}</span></div>
      <div class="split"><span>ارزش روز: <b>${value ? money(value) : '—'}</b></span></div>
    </section>
    <div class="actions">
      <button class="btn" data-action="new-tx" data-asset="${esc(id)}" data-type="buy">خرید</button>
      <button class="btn" data-action="new-tx" data-asset="${esc(id)}" data-type="sell">فروش</button>
      <button class="btn ghost" data-action="price" data-v="${esc(id)}">قیمت روز</button>
      ${asset.priceKeys?.tgju || DEFAULT_PRICE_KEYS.tgju?.[asset.id] ? '' : `<button class="btn ghost" data-action="stock-link" data-v="${esc(id)}">${asset.priceKeys?.tsetmc ? 'تغییر اتصال به بورس' : 'اتصال به بورس'}</button>`}
    </div>
    ${asset.priceKeys?.tsetmc ? `<div class="note info"><span>قیمت این دارایی خودکار از بورس (TSETMC) گرفته می‌شود. کد نماد: <b dir="ltr">${esc(asset.priceKeys.tsetmc)}</b></span></div>` : ''}
    <div class="grid2">
      <div class="tile"><span class="k">میانگین قیمت خرید</span><span class="v">${money(state.avgCost)}</span></div>
      <div class="tile"><span class="k">بهای تمام‌شده‌ی موجودی</span><span class="v">${money(state.costBasis)}</span></div>
      <div class="tile"><span class="k">مجموع مبلغ خرید</span><span class="v">${money(state.totalBought)}</span></div>
      <div class="tile"><span class="k">مجموع کارمزدها</span><span class="v">${money(state.totalFees)}</span></div>
      <div class="tile"><span class="k">قیمت روز</span>${priceTile}</div>
      <div class="tile"><span class="k">سود یا زیان موجودی فعلی</span><span class="v">${pnl(unrealized)}${unrealized && state.costBasis.gt(0) ? ' ' + signedPct(unrealized.div(state.costBasis)) : ''}</span></div>
      <div class="tile"><span class="k">سود یا زیان فروش‌ها</span><span class="v">${pnl(state.realizedPnl)}</span></div>
    </div>
    <h2 class="section-title">تاریخچه</h2>
    <div class="list">${hist}</div>`;
}

/* ------------------------------- معاملات ------------------------------- */

function txMatches(tx: Tx, q: string): boolean {
  if (!q) return true;
  const hay = toEn(
    `${assetName(tx.assetId)} ${tx.note ?? ''} ${TYPE_LABEL[tx.type]} ${formatJalali(tx.date)}`,
  ).toLowerCase();
  return hay.includes(toEn(q).toLowerCase());
}

function txListHtml(): string {
  const rowsById = new Map<string, { realizedPnl: Decimal | null }>();
  for (const a of store.assets) for (const r of computeAssetState(a.id, store.txs).rows) rowsById.set(r.txId, r);
  const f = view.filter;
  const list = store.txs
    .filter((t) => (f === 'deleted' ? !!t.deletedAt : !t.deletedAt))
    .filter((t) =>
      f === 'buy' ? t.type === 'buy' : f === 'sell' ? t.type === 'sell' : f === 'cash' ? t.assetId === CASH_ID : true,
    )
    .filter((t) => txMatches(t, view.search))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.seq - a.seq));
  if (!list.length) {
    return `<div class="empty">${f === 'deleted' ? 'معامله‌ی حذف‌شده‌ای وجود ندارد.' : 'معامله‌ای پیدا نشد.'}</div>`;
  }
  return list
    .map((t) => {
      const asset = assetById(t.assetId);
      const q = parseDec(t.quantity) ?? Decimal.ZERO;
      const p = parseDec(t.unitPrice) ?? Decimal.ZERO;
      const fee = parseDec(t.fee) ?? Decimal.ZERO;
      const isCash = t.assetId === CASH_ID;
      const gross = q.mul(p);
      const total = t.type === 'buy' ? gross.plus(fee) : t.type === 'sell' ? gross.minus(fee) : gross;
      const line = isCash
        ? (t.income ? `${INCOME_LABEL[t.income]}${t.source ? ' ' + esc(t.source) : ''}` : `${TYPE_LABEL[t.type]} نقد`)
        : `${qty(q, asset ?? { id: '', name: '', unit: '', kind: 'custom', decimals: 3 })} × ${money(p, false)}`;
      const r = rowsById.get(t.id);
      const actions = t.deletedAt
        ? `<button class="btn link" data-action="restore-tx" data-v="${t.id}">بازگردانی</button>`
        : `<button class="btn link" data-action="edit-tx" data-v="${t.id}">ویرایش</button>
           <button class="btn link bad" data-action="del-tx" data-v="${t.id}">حذف</button>`;
      return `<div class="row" style="flex-wrap:wrap">
        <div class="main"><span class="t"><span class="badge ${t.type}">${TYPE_LABEL[t.type]}</span> ${esc(assetName(t.assetId))}</span>
          <span class="s">${dateFa(t.date)} · ${line}${fee.gt(0) ? ' · کارمزد ' + money(fee, false) : ''}${t.note ? ' · ' + esc(t.note) : ''}</span></div>
        <div class="side"><span class="t">${money(total)}</span>${r?.realizedPnl ? `<span class="s">${pnl(r.realizedPnl)}</span>` : ''}</div>
        <div style="flex-basis:100%;display:flex;gap:.25rem;justify-content:flex-end">${actions}</div></div>`;
    })
    .join('');
}

function viewTxs(): string {
  const chips: [string, string][] = [['all', 'همه'], ['buy', 'خرید'], ['sell', 'فروش'], ['cash', 'نقد'], ['deleted', 'حذف‌شده']];
  return `${header('معاملات')}
    <div class="field"><label for="search">جست‌وجو (نام دارایی، تاریخ، توضیحات)</label>
      <input id="search" type="search" value="${esc(view.search)}" autocomplete="off"></div>
    <div class="chips" role="group" aria-label="فیلتر">${chips
      .map(([k, l]) => `<button class="chip" data-action="filter" data-v="${k}" aria-pressed="${view.filter === k}">${l}</button>`)
      .join('')}</div>
    <div class="list" id="txlist">${txListHtml()}</div>
    <div class="actions"><button class="btn" data-action="new-tx" data-asset="" data-type="buy">ثبت معامله‌ی جدید</button></div>`;
}

/* ------------------------------- اشخاص ------------------------------- */

/* ------------------------------- اشخاص ------------------------------- */

const peopleData = (): PeopleData => ({ people: store.people, debts: store.debts, payments: store.payments });

/** ثبت ارزش واقعی سبد در لحظه‌ی تغییر؛ واریز/برداشت در ارزش کل دیده می‌شود و سود سرمایه‌گذاری محسوب نمی‌شود. */
function recordHistory() {
  if (store.sample) return;
  logPrices(store.priceLog ?? (store.priceLog = {}), [USD_ID, GOLD_ID], store.prices);
  try {
    const pf0 = computePortfolio(store.assets, store.txs, store.prices);
    const cash = pf0.cash;
    const assetsValue = pf0.assets.reduce((sum, a) => a.value ? sum.plus(a.value) : sum, Decimal.ZERO);
    const worth = netWorth(cash, assetsValue, peopleWithCheques());
    if (worth.isNegative()) return;
    const point: HistoryPoint = { at: new Date().toISOString(), value: worth.toString() };
    const history = store.history ?? (store.history = []);
    const previous = history[history.length - 1];
    // جلوگیری از ثبت چند نقطه‌ی کاملاً یکسان پشت سر هم در فاصله‌ی کوتاه
    if (previous && previous.value === point.value && Date.now() - Date.parse(previous.at) < 15 * 60_000) return;
    history.push(point);
    if (history.length > 500) history.splice(0, history.length - 500);
  } catch {
    // تاریخچه نباید مانع ذخیره‌ی تراکنش یا اطلاعات مالی شود.
  }
}
const nid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function netLabel(net: Decimal): string {
  if (net.isZero()) return '<span class="muted">تسویه‌شده</span>';
  return net.gt(0)
    ? `<span class="gain">او به شما بدهکار است: ${money(net)}</span>`
    : `<span class="loss">شما به او بدهکارید: ${money(net.neg())}</span>`;
}

/* ------------------------------ مدیریت چک‌ها ------------------------------ */
interface ChequeForm {
  mode: 'add' | 'edit'; id?: string; direction: CheckDirection; number: string; bank: string;
  accountHolder: string; amount: string; iy: string; im: string; iday: string;
  dy: string; dm: string; dday: string; status: CheckStatus; note: string; error: string;
}
const CHECK_STATUS: Record<CheckStatus, string> = {
  pending: 'در انتظار سررسید', deposited: 'ارائه‌شده به بانک', cleared: 'وصول / پرداخت‌شده',
  bounced: 'برگشت‌خورده', cancelled: 'باطل‌شده',
};
function newChequeForm(direction: CheckDirection = 'received'): ChequeForm {
  const today = jf(todayIso());
  const due = jf(addJalaliMonths(todayIso(), 1));
  return { mode: 'add', direction, number: '', bank: '', accountHolder: '', amount: '',
    iy: today.y, im: today.m, iday: today.d, dy: due.y, dm: due.m, dday: due.d,
    status: 'pending', note: '', error: '' };
}
function editChequeForm(c: Cheque): ChequeForm {
  const issue = jf(c.issueDate), due = jf(c.dueDate);
  return { mode: 'edit', id: c.id, direction: c.direction, number: c.number, bank: c.bank,
    accountHolder: c.accountHolder, amount: rialToField(c.amount), iy: issue.y, im: issue.m, iday: issue.d,
    dy: due.y, dm: due.m, dday: due.d, status: c.status, note: c.note ?? '', error: '' };
}
function chequeFormHtml(f: ChequeForm): string {
  const dirs = [['received','چک دریافتی'],['issued','چک پرداختی']] as [string,string][];
  const status = Object.entries(CHECK_STATUS).map(([k,v]) => `<option value="${k}" ${f.status===k?'selected':''}>${v}</option>`).join('');
  return sheet(`<h2>${f.mode==='edit'?'ویرایش چک':'ثبت چک جدید'}</h2>
    <div class="field"><span class="lab">نوع چک</span>${seg('check-dir', f.direction, dirs)}</div>
    <div class="field"><label for="ck-number">شماره چک / شناسه صیادی</label><input id="ck-number" data-field="number" value="${esc(f.number)}" autocomplete="off"></div>
    <div class="field"><label for="ck-bank">بانک</label><input id="ck-bank" data-field="bank" value="${esc(f.bank)}"></div>
    <div class="field"><label for="ck-holder">صاحب حساب / صادرکننده</label><input id="ck-holder" data-field="accountHolder" value="${esc(f.accountHolder)}"></div>
    <div class="field"><label for="ck-amount">مبلغ (${unitLabel()})</label><input id="ck-amount" data-field="amount" inputmode="decimal" value="${esc(f.amount)}"></div>
    <div class="field"><span class="lab">تاریخ صدور (سال، ماه، روز شمسی)</span>${dateFields(f.iy,f.im,f.iday,['ck-iy','ck-im','ck-id'],['iy','im','iday'])}</div>
    <div class="field"><span class="lab">تاریخ سررسید (سال، ماه، روز شمسی)</span>${dateFields(f.dy,f.dm,f.dday,['ck-dy','ck-dm','ck-dd'],['dy','dm','dday'])}</div>
    <div class="field"><label for="ck-status">وضعیت چک</label><select id="ck-status" data-field="status">${status}</select></div>
    <div class="field"><label for="ck-note">توضیحات</label><textarea id="ck-note" data-field="note" rows="2">${esc(f.note)}</textarea></div>
    <div class="err" id="ferr" role="alert">${esc(f.error)}</div>
    <div class="actions"><button class="btn" data-action="check-save">ذخیره چک</button><button class="btn ghost" data-action="close">انصراف</button></div>`);
}
function saveCheque() {
  if (modal?.kind !== 'check') return;
  const f = modal.f;
  const issueDate = jalaliToIso(Number(toEn(f.iy)),Number(toEn(f.im)),Number(toEn(f.iday)));
  const dueDate = jalaliToIso(Number(toEn(f.dy)),Number(toEn(f.dm)),Number(toEn(f.dday)));
  if (!issueDate || !dueDate) return setErr('تاریخ صدور یا سررسید معتبر نیست.');
  const amount = parseField('مبلغ چک',f.amount);
  if (typeof amount === 'string') return setErr(amount);
  const data = { direction:f.direction, number:f.number.trim(), bank:f.bank.trim(), accountHolder:f.accountHolder.trim(),
    amount:toRialDec(amount).toString(), issueDate, dueDate, status:f.status, note:f.note.trim() || undefined };
  const validation = validateCheque(data);
  if (!validation.valid) return setErr(validation.error ?? 'اطلاعات چک معتبر نیست.');
  const now = new Date().toISOString();
  const previous = f.id ? (store.cheques ?? []).find(x=>x.id===f.id) : undefined;
  if (duplicateCheque(store.cheques ?? [], data, previous?.id)) return setErr('این چک (همین شماره، بانک و نوع) قبلاً ثبت شده است.');
  // موجودی نقد: «وصول‌شده» مبلغ را به نقد اضافه یا از آن کم می‌کند
  let txs = store.txs;
  let cashTxId = previous?.cashTxId;
  let negCash = false;
  const wasCleared = previous?.status === 'cleared' && !!cashTxId;
  const probe = { ...data, id: previous?.id ?? 'new', createdAt: now, updatedAt: now } as Cheque;
  if (data.status === 'cleared') {
    if (wasCleared && cashTxId) {
      if (previous && previous.amount !== data.amount) {
        const r = updateTx(txs, cashTxId, { quantity: data.amount });
        if (!r.ok) return setErr('تغییر مبلغ چک ممکن نیست.');
        negCash = r.issues.some((i) => i.code === 'NEGATIVE_CASH');
        txs = r.txs;
      }
    } else {
      const r = addTx(txs, chequeCashDraft(probe, todayIso()));
      if (!r.ok) return setErr('ثبت وصول چک در نقد انجام نشد.');
      negCash = r.issues.some((i) => i.code === 'NEGATIVE_CASH');
      txs = r.txs;
      cashTxId = r.txs[r.txs.length - 1].id;
    }
  } else if (wasCleared && cashTxId) {
    const r = deleteTx(txs, cashTxId, now);
    if (!r.ok) return setErr('برگرداندن وضعیت چک ممکن نیست.');
    negCash = r.issues.some((i) => i.code === 'NEGATIVE_CASH');
    txs = r.txs;
    cashTxId = undefined;
  }
  // یادآور: اگر کاربر قبلاً «انجام شد» زده و سررسید عوض نشده، همان نگه داشته می‌شود
  const open = data.status==='pending' || data.status==='deposited' || data.status==='bounced';
  const oldRem = previous?.reminderId ? remList().find(r=>r.id===previous.reminderId) : undefined;
  const keepRem = !!(open && oldRem && oldRem.kind==='date' && oldRem.date===data.dueDate);
  if (previous?.reminderId && !keepRem) store.reminders = remList().filter(r=>r.id!==previous.reminderId);
  const reminderId = keepRem ? previous!.reminderId : open ? nid('r') : undefined;
  const item: Cheque = { ...data, id:f.id ?? nid('ck'), reminderId, ...(cashTxId ? { cashTxId } : {}),
    createdAt:previous?.createdAt ?? now, updatedAt:now };
  store.txs = txs;
  store.cheques = f.mode==='edit' ? (store.cheques ?? []).map(x=>x.id===item.id?item:x) : [...(store.cheques ?? []),item];
  if (reminderId && !keepRem) remList().push({ id:reminderId, kind:'date', title:`سررسید چک ${item.direction==='received'?'دریافتی':'پرداختی'} · ${item.bank}`, date:item.dueDate, leadDays:1, note:`شماره چک: ${item.number}` });
  save(); closeModal(); render(); toast((f.mode==='edit'?'چک ویرایش شد.':'چک ثبت شد.') + (negCash ? ' هشدار: موجودی نقد منفی شد؛ واریز یا موجودی اولیه را ثبت کنید.' : ''));
}
function chequeListHtml(): string {
  const items = sortCheques(store.cheques ?? []);
  if (!items.length) return '<div class="empty">هنوز چکی ثبت نشده است.</div>';
  return `<div class="list">${items.map(c=>{
    const due=chequeDue(c,todayIso());
    const dir=c.direction==='received'?'دریافتی':'پرداختی';
    const dueLabel=due==='overdue'?'سررسید گذشته':due==='today'?'سررسید امروز':due==='upcoming'?'سررسید آینده':'مختومه';
    return `<div class="row"><div class="main"><span class="t">${dir} · ${esc(c.bank)} · ${money(Decimal.of(c.amount))}</span>
      <span class="s">شماره: ${esc(c.number)} · ${esc(c.accountHolder)}</span>
      <span class="s">سررسید: ${dateFa(c.dueDate)} · ${CHECK_STATUS[c.status]}</span>
      <span class="s"><button class="btn link" data-action="check-edit" data-v="${esc(c.id)}">ویرایش</button>
      <button class="btn link bad" data-action="check-del" data-v="${esc(c.id)}">حذف</button></span></div>
      <span class="badge ${due==='overdue'?'sell':due==='closed'?'':'buy'}">${dueLabel}</span></div>`;
  }).join('')}</div>`;
}

function viewPeople(): string {
  if (view.person) return viewPerson(view.person);
  const sum = computePeople(peopleData(), todayIso());
  const rows = sum.persons
    .map(
      (ps) => `<button class="row" data-action="open-person" data-v="${esc(ps.person.id)}">
        <div class="main"><span class="t">${esc(ps.person.name)}</span>
        <span class="s">${toFa(String(ps.debts.length))} مورد${
          ps.overdueCount ? ` · <b class="loss">${toFa(String(ps.overdueCount))} قسط سررسید گذشته</b>` : ''
        }</span></div>
        <div class="side">${netLabel(ps.net)}</div></button>`,
    )
    .join('');
  const chequeItems = store.cheques ?? [];
  const incoming = chequeItems.filter(c=>c.direction==='received' && c.status!=='cleared' && c.status!=='cancelled').length;
  const outgoing = chequeItems.filter(c=>c.direction==='issued' && c.status!=='cleared' && c.status!=='cancelled').length;
  return `${header('تعهدات مالی')}
    <div class="grid2">
      <div class="tile"><span class="k">جمع طلب‌های شما</span><span class="v gain">${money(sum.receivable)}</span></div>
      <div class="tile"><span class="k">جمع بدهی‌های شما</span><span class="v loss">${money(sum.payable)}</span></div>
    </div>
    <h2 class="section-title">چک‌ها</h2>
    <div class="grid2"><div class="tile"><span class="k">چک‌های دریافتی باز</span><span class="v">${toFa(String(incoming))} فقره · ${money(chequeTotals(chequeItems).receivable)}</span></div><div class="tile"><span class="k">چک‌های پرداختی باز</span><span class="v">${toFa(String(outgoing))} فقره · ${money(chequeTotals(chequeItems).payable)}</span></div></div>
    <div class="actions"><button class="btn" data-action="check-new" data-v="received">ثبت چک دریافتی</button><button class="btn ghost" data-action="check-new" data-v="issued">ثبت چک پرداختی</button></div>
    ${chequeListHtml()}
    <h2 class="section-title">طلب‌ها و بدهی‌ها</h2>
    <div class="actions">
      <button class="btn" data-action="new-debt" data-v="lent">به کسی پول دادم</button>
      <button class="btn" data-action="new-debt" data-v="borrowed">وام یا قرض گرفتم</button>
      <button class="btn ghost" data-action="loan-open">ماشین‌حساب وام و قسط</button>
    </div>
    <div class="list">${rows || '<div class="empty">هنوز شخصی یا وامی ثبت نشده است.<br>مثلاً «به علی ۱۰ میلیون قرض دادم» یا «وام بانک ۱۵ میلیون گرفتم».</div>'}</div>
    <div class="note info"><span>طلب‌ها، بدهی‌ها و چک‌های باز در «سرمایه‌ی خالص» صفحه‌ی خانه حساب می‌شوند: نقد + دارایی‌ها + طلب‌ها − بدهی‌ها. چک دریافتیِ برگشتی قابل‌وصول حساب نمی‌شود. با «وصول‌شده» کردن چک، مبلغ در نقد واریز یا برداشت می‌شود.</span></div>`;
}

function debtCard(ds: DebtState): string {
  const d = ds.debt;
  const lent = d.direction === 'lent';
  const pct = ds.total.gt(0) ? Math.min(100, ds.paid.div(ds.total).toNumber() * 100).toFixed(1) : '0';
  const STATUS = { paid: 'پرداخت شد', partial: 'نیمه‌پرداخت', unpaid: 'در انتظار' } as const;
  const sched = ds.schedule.length
    ? `<h2 class="section-title"><span>جدول اقساط</span></h2><div class="list">${ds.schedule
        .map(
          (r) => `<div class="row"><div class="main"><span class="t">قسط ${toFa(String(r.index))} · ${dateFa(r.dueDate)}</span>
            <span class="s">${money(r.amount)}${r.status === 'partial' ? ` · پرداخت‌شده ${money(r.paidPart)}` : ''}</span></div>
            <span class="badge ${r.status === 'paid' ? 'buy' : r.overdue ? 'sell' : ''}">${r.overdue ? 'سررسید گذشته' : STATUS[r.status]}</span></div>`,
        )
        .join('')}</div>`
    : '';
  const pays = ds.payments.length
    ? `<h2 class="section-title"><span>پرداخت‌ها به تفکیک تاریخ</span></h2><div class="list">${ds.payments
        .map(
          (p) => `<div class="row" style="flex-wrap:wrap"><div class="main"><span class="t">${dateFa(p.date)} · ${money(p.amount)}</span>
            <span class="s">مانده پس از آن: ${money(p.remainingAfter)}${p.fromCash ? ' · روی وجه نقد اثر گذاشت' : ''}${p.note ? ' · ' + esc(p.note) : ''}</span></div>
            <div class="side"><button class="btn link" data-action="edit-pay" data-v="${esc(p.id)}">ویرایش</button>
            <button class="btn link bad" data-action="del-pay" data-v="${esc(p.id)}">حذف</button></div></div>`,
        )
        .join('')}</div>`
    : '<div class="muted">هنوز پرداختی ثبت نشده است.</div>';
  const next = ds.nextDue && !ds.settled
    ? `<div class="row"><span>قسط بعدی</span><b>${dateFa(ds.nextDue.dueDate)} · ${money(ds.nextDue.amount.minus(ds.nextDue.paidPart))}</b></div>`
    : '';
  return `<section class="card">
    <div class="between"><b>${esc(d.title)}</b>
      <span class="badge ${lent ? 'sell' : 'buy'}">${lent ? 'به او دادم' : 'از او گرفتم'}</span></div>
    <div class="summary">
      <div class="row"><span>تاریخ</span><b>${dateFa(d.date)}</b></div>
      <div class="row"><span>مبلغ کل</span><b>${money(ds.total)}</b></div>
      <div class="row"><span>پرداخت‌شده تا امروز</span><b>${money(ds.paid)}</b></div>
      <div class="row"><span>مانده</span><b>${ds.settled ? '<span class="gain">تسویه شد</span>' : money(ds.remaining)}</b></div>
      ${next}
      ${d.fromCash ? `<div class="row"><span>وجه نقد</span><b>${lent ? 'هنگام ثبت کم شد' : 'هنگام ثبت زیاد شد'}</b></div>` : ''}
    </div>
    <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
    <div class="actions">
      ${ds.settled ? '' : `<button class="btn" data-action="new-pay" data-v="${esc(d.id)}">ثبت پرداخت</button>
      <button class="btn ghost" data-action="settle" data-v="${esc(d.id)}">تسویه‌ی کامل</button>`}
      <button class="btn link" data-action="edit-debt" data-v="${esc(d.id)}">ویرایش</button>
      <button class="btn link bad" data-action="del-debt" data-v="${esc(d.id)}">حذف</button>
    </div>
    ${sched}${pays}</section>`;
}

function viewPerson(id: string): string {
  const ps = computePeople(peopleData(), todayIso()).persons.find((p) => p.person.id === id);
  if (!ps) {
    view.person = null;
    return viewPeople();
  }
  return `<header class="top"><h1>${esc(ps.person.name)}</h1>
      <button class="btn link" data-action="back">بازگشت به اشخاص</button></header>
    <section class="hero" aria-label="وضعیت حساب">
      <span class="label">وضعیت حساب</span>
      <div class="big" style="font-size:1.4rem">${netLabel(ps.net)}</div>
      <div class="split"><span>طلب شما: <b>${money(ps.receivable, false)}</b></span><span>بدهی شما: <b>${money(ps.payable, false)}</b></span></div>
    </section>
    <div class="actions">
      <button class="btn" data-action="new-debt" data-v="lent" data-person="${esc(ps.person.name)}">به او پول دادم</button>
      <button class="btn" data-action="new-debt" data-v="borrowed" data-person="${esc(ps.person.name)}">از او گرفتم</button>
      <button class="btn link bad" data-action="del-person" data-v="${esc(ps.person.id)}">حذف شخص</button>
    </div>
    ${ps.debts.map(debtCard).join('') || '<div class="empty">برای این شخص وامی ثبت نشده است.</div>'}`;
}

/* ---- فرم‌های وام و پرداخت ---- */

interface DebtForm {
  mode: 'add' | 'edit'; id?: string;
  name: string; direction: Direction; title: string; amount: string;
  y: string; m: string; d: string;
  plan: boolean; count: string; installment: string; every: string; fy: string; fm: string; fd: string;
  fromCash: boolean; note: string; error: string;
}
interface PayForm {
  mode: 'add' | 'edit'; id?: string; debtId: string;
  y: string; m: string; d: string; amount: string; fromCash: boolean; note: string; error: string;
}

function jf(iso: string): { y: string; m: string; d: string } {
  const j = isoToJalali(iso)!;
  return { y: toFa(String(j.y)), m: toFa(String(j.m)), d: toFa(String(j.d)) };
}

function newDebtForm(direction: Direction, name = ''): DebtForm {
  const t = jf(todayIso());
  const n = jf(addJalaliMonths(todayIso(), 1));
  return {
    mode: 'add', name, direction, title: '', amount: '', ...t,
    plan: false, count: '', installment: '', every: '۱', fy: n.y, fm: n.m, fd: n.d,
    fromCash: false, note: '', error: '',
  };
}

function editDebtForm(d: Debt): DebtForm {
  const t = jf(d.date);
  const p = d.plan;
  const n = jf(p?.firstDate ?? addJalaliMonths(d.date, 1));
  return {
    mode: 'edit', id: d.id, name: store.people.find((x) => x.id === d.personId)?.name ?? '',
    direction: d.direction, title: d.title, amount: rialToField(d.amount), ...t,
    plan: !!p, count: p ? toFa(String(p.count)) : '', installment: p ? rialToField(p.installment) : '',
    every: p ? toFa(String(p.everyMonths)) : '۱', fy: n.y, fm: n.m, fd: n.d,
    fromCash: !!d.fromCash, note: d.note ?? '', error: '',
  };
}

function dateFields(y: string, m: string, d: string, ids: [string, string, string], fields: [string, string, string]): string {
  return `<div class="three">
    <input id="${ids[0]}" data-field="${fields[0]}" inputmode="numeric" value="${esc(y)}" aria-label="سال">
    <input id="${ids[1]}" data-field="${fields[1]}" inputmode="numeric" value="${esc(m)}" aria-label="ماه">
    <input id="${ids[2]}" data-field="${fields[2]}" inputmode="numeric" value="${esc(d)}" aria-label="روز"></div>`;
}

function debtFormHtml(f: DebtForm): string {
  const lent = f.direction === 'lent';
  const names = store.people.filter((p) => !p.deletedAt).map((p) => `<option value="${esc(p.name)}"></option>`).join('');
  return sheet(`
    <h2>${f.mode === 'edit' ? 'ویرایش وام یا قرض' : lent ? 'ثبت پولی که دادم' : 'ثبت پولی که گرفتم'}</h2>
    <div class="field"><span class="lab">نوع</span><div class="seg">
      <button data-action="debt-dir" data-v="lent" aria-pressed="${lent}">به او دادم</button>
      <button data-action="debt-dir" data-v="borrowed" aria-pressed="${!lent}">از او گرفتم</button></div></div>
    <div class="field"><label for="d-name">نام شخص یا بانک</label>
      <input id="d-name" data-field="name" list="d-names" value="${esc(f.name)}" autocomplete="off" placeholder="مثلاً علی یا بلو بانک">
      <datalist id="d-names">${names}</datalist></div>
    <div class="field"><label for="d-title">عنوان (اختیاری)</label>
      <input id="d-title" data-field="title" value="${esc(f.title)}" autocomplete="off" placeholder="مثلاً قرض یا وام خرید"></div>
    <div class="field"><label for="d-amount">مبلغ کلی که باید برگردد (${unitLabel()})</label>
      <input id="d-amount" data-field="amount" inputmode="decimal" value="${esc(f.amount)}" autocomplete="off">
      <span class="hint">برای وام بانکی، جمع کل بازپرداخت (با سود) را وارد کنید.</span></div>
    <div class="field"><span class="lab">تاریخ ${lent ? 'پرداخت' : 'دریافت'} (شمسی)</span>${dateFields(f.y, f.m, f.d, ['d-y', 'd-m', 'd-d'], ['y', 'm', 'd'])}</div>
    <label class="check"><input type="checkbox" data-field="plan" ${f.plan ? 'checked' : ''}><span>اقساطی است</span></label>
    ${
      f.plan
        ? `<div class="field"><label for="d-count">تعداد اقساط</label>
            <input id="d-count" data-field="count" inputmode="numeric" value="${esc(f.count)}" autocomplete="off"></div>
          <div class="field"><label for="d-inst">مبلغ هر قسط (${unitLabel()})</label>
            <input id="d-inst" data-field="installment" inputmode="decimal" value="${esc(f.installment)}" autocomplete="off">
            <span class="hint">اگر خالی بماند، مبلغ کل به تعداد اقساط تقسیم می‌شود.</span></div>
          <div class="field"><span class="lab">سررسید قسط اول (شمسی)</span>${dateFields(f.fy, f.fm, f.fd, ['d-fy', 'd-fm', 'd-fd'], ['fy', 'fm', 'fd'])}</div>
          <div class="field"><label for="d-every">فاصله‌ی اقساط (ماه)</label>
            <input id="d-every" data-field="every" inputmode="numeric" value="${esc(f.every)}" autocomplete="off"></div>`
        : ''
    }
    <label class="check"><input type="checkbox" data-field="fromCash" ${f.fromCash ? 'checked' : ''}>
      <span>${lent ? 'این مبلغ از وجه نقد من کم شود' : 'این مبلغ به وجه نقد من اضافه شود'}</span></label>
    <div class="hint">اگر خاموش باشد، وجه نقد شما تغییر نمی‌کند (مثلاً وقتی پول را جای دیگری دریافت یا پرداخت کرده‌اید).</div>
    <div class="field"><label for="d-note">توضیحات (اختیاری)</label>
      <input id="d-note" data-field="note" value="${esc(f.note)}" autocomplete="off"></div>
    <div class="err" id="ferr" role="alert">${esc(f.error)}</div>
    <div class="actions"><button class="btn" data-action="debt-save">ذخیره</button>
      <button class="btn ghost" data-action="close">انصراف</button></div>`);
}

function payFormHtml(f: PayForm): string {
  const debt = store.debts.find((d) => d.id === f.debtId);
  const ds = debt ? computeDebt(debt, store.payments.filter((p) => p.id !== f.id), todayIso()) : null;
  const lent = debt?.direction === 'lent';
  return sheet(`
    <h2>${f.mode === 'edit' ? 'ویرایش پرداخت' : 'ثبت پرداخت'}</h2>
    ${debt ? `<div class="note info"><span>${esc(debt.title)} · مانده‌ی فعلی: <b>${ds ? money(ds.remaining) : ''}</b></span></div>` : ''}
    <div class="field"><label for="p-amount">مبلغ پرداخت (${unitLabel()})</label>
      <input id="p-amount" data-field="amount" inputmode="decimal" value="${esc(f.amount)}" autocomplete="off"></div>
    <div class="field"><span class="lab">تاریخ پرداخت (شمسی)</span>${dateFields(f.y, f.m, f.d, ['q-y', 'q-m', 'q-d'], ['y', 'm', 'd'])}</div>
    <label class="check"><input type="checkbox" data-field="fromCash" ${f.fromCash ? 'checked' : ''}>
      <span>${lent ? 'این مبلغ به وجه نقد من اضافه شود' : 'این مبلغ از وجه نقد من کم شود'}</span></label>
    <div class="field"><label for="q-note">توضیحات (اختیاری)</label>
      <input id="q-note" data-field="note" value="${esc(f.note)}" autocomplete="off"></div>
    <div class="err" id="ferr" role="alert">${esc(f.error)}</div>
    <div class="actions"><button class="btn" data-action="pay-save">ذخیره</button>
      <button class="btn ghost" data-action="close">انصراف</button></div>`);
}

function openPayForm(debtId: string, settle: boolean) {
  const debt = store.debts.find((d) => d.id === debtId);
  if (!debt) return;
  const ds = computeDebt(debt, store.payments, todayIso());
  let amt = ds.remaining;
  if (!settle && ds.nextDue) {
    const due = ds.nextDue.amount.minus(ds.nextDue.paidPart);
    if (due.gt(0) && due.lt(amt)) amt = due;
  }
  modal = { kind: 'pay', f: { mode: 'add', debtId, ...jf(todayIso()), amount: rialToField(amt.toString()), fromCash: false, note: '', error: '' } };
  renderModal();
}

/** تغییر داده‌های اشخاص با اعتبارسنجی؛ در صورت خطا پیام برمی‌گرداند */
function applyPeople(next: PeopleData): string | null {
  const issues = validatePeople(next);
  if (issues.length) return issues[0].message;
  store.people = next.people;
  store.debts = next.debts;
  store.payments = next.payments;
  save();
  return null;
}

function saveDebt() {
  if (modal?.kind !== 'debt') return;
  const f = modal.f;
  const name = f.name.trim();
  if (!name) return setErr('نام شخص یا بانک را وارد کنید.');
  const amt = parseField('مبلغ', f.amount);
  if (typeof amt === 'string') return setErr(amt);
  const rial = toRialDec(amt);
  if (rial.lte(0) || !rial.isInteger()) return setErr('مبلغ باید بیشتر از صفر و بدون اعشار (به ریال) باشد.');
  const date = jalaliToIso(Number(toEn(f.y)), Number(toEn(f.m)), Number(toEn(f.d)));
  if (!date) return setErr('تاریخ شمسی معتبر نیست.');
  let plan: Debt['plan'];
  if (f.plan) {
    const count = Number(toEn(f.count));
    if (!Number.isInteger(count) || count < 1) return setErr('تعداد اقساط را وارد کنید.');
    const every = Number(toEn(f.every) || '1');
    if (!Number.isInteger(every) || every < 1) return setErr('فاصله‌ی اقساط باید عدد ماه باشد.');
    const first = jalaliToIso(Number(toEn(f.fy)), Number(toEn(f.fm)), Number(toEn(f.fd)));
    if (!first) return setErr('تاریخ سررسید قسط اول معتبر نیست.');
    let inst: Decimal;
    if (f.installment.trim() === '') {
      inst = Decimal.of(rial.div(count).roundToInt());
      if (inst.mul(count).lt(rial)) inst = inst.plus(1);
    } else {
      const v = parseField('مبلغ قسط', f.installment);
      if (typeof v === 'string') return setErr(v);
      inst = toRialDec(v);
    }
    plan = { count, installment: inst.toString(), firstDate: first, everyMonths: every };
  }
  let people = store.people;
  let person = people.find((p) => !p.deletedAt && p.name === name);
  if (!person) {
    person = { id: nid('p'), name };
    people = [...people, person];
  }
  const debt: Debt = {
    id: f.id ?? nid('d'), personId: person.id, direction: f.direction,
    title: f.title.trim() || (f.direction === 'lent' ? 'قرض' : 'وام'),
    amount: rial.toString(), date, plan, fromCash: f.fromCash || undefined, note: f.note.trim() || undefined,
  };
  const debts = f.mode === 'edit' ? store.debts.map((d) => (d.id === debt.id ? debt : d)) : [...store.debts, debt];
  const err = applyPeople({ people, debts, payments: store.payments });
  if (err) return setErr(err);
  closeModal();
  view.tab = 'people';
  view.person = person.id;
  render();
  toast(f.mode === 'edit' ? 'وام ویرایش شد.' : 'ثبت شد.');
}

function savePay() {
  if (modal?.kind !== 'pay') return;
  const f = modal.f;
  const amt = parseField('مبلغ', f.amount);
  if (typeof amt === 'string') return setErr(amt);
  const rial = toRialDec(amt);
  if (rial.lte(0) || !rial.isInteger()) return setErr('مبلغ باید بیشتر از صفر و بدون اعشار (به ریال) باشد.');
  const date = jalaliToIso(Number(toEn(f.y)), Number(toEn(f.m)), Number(toEn(f.d)));
  if (!date) return setErr('تاریخ شمسی معتبر نیست.');
  const pay: DebtPayment = {
    id: f.id ?? nid('q'), debtId: f.debtId, date, amount: rial.toString(),
    fromCash: f.fromCash || undefined, note: f.note.trim() || undefined,
  };
  const payments = f.mode === 'edit' ? store.payments.map((p) => (p.id === pay.id ? pay : p)) : [...store.payments, pay];
  const err = applyPeople({ people: store.people, debts: store.debts, payments });
  if (err) return setErr(err);
  closeModal();
  render();
  toast('پرداخت ثبت شد.');
}

/** حذف نرم با امکان برگرداندن */
function softDelete(kind: 'debt' | 'payment' | 'person', id: string) {
  const snap = JSON.stringify(peopleData());
  const now = new Date().toISOString();
  const mark = <T extends { id: string; deletedAt?: string | null }>(xs: T[], pred: (x: T) => boolean): T[] =>
    xs.map((x) => (pred(x) ? { ...x, deletedAt: now } : x));
  let next = peopleData();
  if (kind === 'payment') next = { ...next, payments: mark(next.payments, (p) => p.id === id) };
  else if (kind === 'debt') next = { ...next, debts: mark(next.debts, (d) => d.id === id) };
  else {
    next = { ...next, people: mark(next.people, (p) => p.id === id), debts: mark(next.debts, (d) => d.personId === id) };
    view.person = null;
  }
  const err = applyPeople(next);
  if (err) return toast(`حذف ممکن نیست: ${err}`);
  render();
  toast('حذف شد. می‌توانید آن را برگردانید.', () => {
    const o = JSON.parse(snap) as PeopleData;
    applyPeople(o);
    render();
  });
}

/* ------------------------------- تنظیمات ------------------------------- */

function seg(action: string, cur: string, opts: [string, string][]): string {
  return `<div class="seg">${opts
    .map(([k, l]) => `<button data-action="${action}" data-v="${k}" aria-pressed="${cur === k}">${l}</button>`)
    .join('')}</div>`;
}

const SUPPORT_ID = '@Hooman_tavakoli75';
const SUPPORT_URL = 'https://t.me/Hooman_tavakoli75';

const installedBuild = (): number => Number((window as unknown as { __APP_BUILD?: number }).__APP_BUILD) || upd.current;

function updateSection(): string {
  if (!inApp()) return '';
  const cur = installedBuild();
  const verLine = (label: string, n: number) => `<span>${label}: <b>${n ? toFa(String(n)) + ' ' + ltr('(apk-' + n + ')') : '—'}</b></span>`;
  const mb = (b: number) => (b ? ` (${toFa((b / 1048576).toFixed(0))} مگابایت)` : '');
  let body: string;
  switch (upd.status) {
    case 'checking': body = '<span>در حال بررسی…</span>'; break;
    case 'none': body = '<span>برنامه‌ی شما به‌روز است (آخرین نسخه‌ی منتشرشده همین است).</span><button class="btn link" data-action="update-check">بررسی دوباره</button>'; break;
    case 'available':
      body = `<span>نسخه‌ی جدید آماده است${mb(upd.size)}. داده‌های شما پاک نمی‌شود.</span>
        <button class="btn" data-action="update-install">دانلود و نصب</button>`;
      break;
    case 'downloading': body = '<span>در حال دانلود: <b id="upd-pct">' + toFa(String(upd.pct)) + '٪</b></span>'; break;
    case 'installing': body = '<span>صفحه‌ی نصب باز شد. گزینه‌ی «نصب» یا «به‌روزرسانی» را بزنید.</span>'; break;
    case 'error': body = `<span class="loss">${esc(upd.error)}</span><button class="btn link" data-action="update-check">تلاش دوباره</button>`; break;
    default: body = '<button class="btn ghost" data-action="update-check">بررسی به‌روزرسانی</button>';
  }
  return `<h2 class="section-title">به‌روزرسانی برنامه</h2>
    <div class="note info">${verLine('نسخه‌ی نصب‌شده', cur)}${verLine('آخرین نسخه‌ی منتشرشده', upd.latest)}${body}</div>`;
}

/* ------------------------------ پشتیبان‌گیری ------------------------------ */

function backupInfoHtml(): string {
  const last = store.settings.lastBackup;
  const days = last ? Math.floor((Date.now() - Date.parse(last)) / 86400000) : null;
  return last
    ? `آخرین پشتیبان ساخته‌شده: ${dateFa(last.slice(0, 10))}${days && days > 0 ? ` (${toFa(String(days))} روز پیش)` : ' (امروز)'}`
    : 'هنوز پشتیبانی ساخته نشده است.';
}

/** وضعیت داده برای تصمیم درباره‌ی یادآوری: داده‌ی واقعی و بدون پشتیبان یا پشتیبان قدیمی */
function backupDue(): boolean {
  if (store.sample || (!store.txs.length && !store.debts.length)) return false;
  const last = store.settings.lastBackup;
  return !last || Date.now() - Date.parse(last) > 30 * 86400000;
}

function normalizeStore(raw: unknown): Store | null {
  const s = raw as Store | null;
  if (!s || s.v !== 1 || !Array.isArray(s.assets) || !Array.isArray(s.txs) || !s.settings || typeof s.settings !== 'object') return null;
  if (!s.prices || typeof s.prices !== 'object') s.prices = {};
  if (!s.market || !Array.isArray(s.market.entries)) s.market = bundledMarket();
  for (const k of ['people', 'debts', 'payments', 'history', 'reminders', 'cheques'] as const) if (!Array.isArray(s[k])) (s as unknown as Record<string, unknown[]>)[k] = [];
  s.sample = false;
  return s;
}

/** فایل متنی (CSV) را در اپ با منوی اشتراک‌گذاری و در مرورگر با دانلود می‌دهد */
function exportFile(name: string, text: string, mime = 'text/csv') {
  if (inApp()) {
    toNative({ type: 'share-file', name, text, mime });
    toast('فایل ساخته شد؛ مقصد (مثلاً جیمیل یا Drive) را انتخاب کنید.');
    return;
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('فایل دانلود شد.');
  } catch {
    toast('ساخت فایل ممکن نشد.');
  }
}

async function makeBackup() {
  if (modal?.kind !== 'backup') return;
  const f = modal.f;
  if (f.pass.trim().length < MIN_PASSPHRASE) return setErr(`رمز باید دست‌کم ${toFa(String(MIN_PASSPHRASE))} نویسه باشد.`);
  if (f.pass !== f.pass2) return setErr('رمز و تکرار آن یکی نیست.');
  f.busy = true;
  setErr('');
  try {
    const stamp = new Date().toISOString();
    const text = await encryptBackup(JSON.stringify({ app: 'hooman-finance', at: stamp, store: { ...store, settings: { ...store.settings, lock: undefined } } }), f.pass);
    const name = `hooman-finance-backup-${todayIso()}.hfbackup`;
    store.settings.lastBackup = stamp;
    save();
    if (inApp()) {
      toNative({ type: 'share-file', name, text });
      closeModal();
      render();
      toast('فایل پشتیبان ساخته شد؛ مقصد (مثلاً جیمیل) را انتخاب کنید.');
    } else {
      try { await navigator.clipboard?.writeText(text); } catch { /* ignore */ }
      closeModal();
      render();
      toast('در نسخه‌ی وب فایل ساخته نمی‌شود؛ متن رمزدار پشتیبان کپی شد.');
    }
  } catch (e) {
    f.busy = false;
    setErr(e instanceof BackupError ? e.message : 'ساخت پشتیبان ناموفق بود.');
  }
}

async function restoreCheck() {
  if (modal?.kind !== 'restore') return;
  const f = modal.f;
  if (!f.pass) return setErr('رمز پشتیبان را وارد کنید.');
  f.busy = true;
  setErr('');
  try {
    const obj = JSON.parse(await decryptBackup(f.text, f.pass)) as { app?: string; at?: string; store?: unknown };
    const st = obj.app === 'hooman-finance' ? normalizeStore(obj.store) : null;
    if (!st) throw new BackupError('محتوای پشتیبان معتبر نیست.');
    f.parsed = st;
    f.at = typeof obj.at === 'string' ? obj.at : '';
    f.stage = 'confirm';
    f.busy = false;
    renderModal();
  } catch (e) {
    f.busy = false;
    setErr(e instanceof BackupError ? e.message : 'خواندن پشتیبان ناموفق بود.');
  }
}

function restoreApply() {
  if (modal?.kind !== 'restore' || !modal.f.parsed) return;
  try { localStorage.setItem('hooman-finance-before-restore', JSON.stringify(store)); } catch { /* ignore */ }
  const keepLock = store.settings.lock;
  store = modal.f.parsed;
  if (keepLock) store.settings.lock = keepLock;
  else delete store.settings.lock;
  view.assetId = null;
  writesBlocked = false;
  save();
  closeModal();
  render();
  toast('اطلاعات از پشتیبان بازیابی شد.');
}

/* ------------------------------ قفل برنامه ------------------------------ */

const LOCKFAIL_KEY = 'hooman-finance-lockfail';
const lk = { locked: false, cover: false, entry: '', msg: '', busy: false, hiddenAt: 0, bioAvail: false, forgot: false };
let lkTick: number | undefined;

function readFail(): { fails: number; until: number } {
  try {
    const o = JSON.parse(localStorage.getItem(LOCKFAIL_KEY) ?? '{}') as { fails?: number; until?: number };
    return { fails: Number(o.fails) || 0, until: Number(o.until) || 0 };
  } catch {
    return { fails: 0, until: 0 };
  }
}
function writeFail(f: { fails: number; until: number }) {
  try { localStorage.setItem(LOCKFAIL_KEY, JSON.stringify(f)); } catch { /* ignore */ }
}

function renderLock() {
  const lockEl = document.getElementById('lock') as HTMLElement | null;
  const lock = store.settings.lock;
  if (!lockEl) return;
  const show = !!lock && (lk.locked || lk.cover);
  lockEl.hidden = !show;
  appEl.toggleAttribute('inert', show);
  if (!show || !lock) { lockEl.innerHTML = ''; return; }
  const brand = '<div class="lk-brand">Dara | دارا</div>';
  if (!lk.locked) { lockEl.innerHTML = `<div class="lockscr">${brand}</div>`; return; }
  if (lk.forgot) {
    lockEl.innerHTML = `<div class="lockscr">${brand}
      <div class="note"><span>اگر رمز یا الگو را فراموش کرده‌اید، تنها راه این است که همه‌ی اطلاعات این برنامه از روی این گوشی پاک شود و قفل برداشته شود. بعد می‌توانید از فایل پشتیبان (تنظیمات ← بازیابی) اطلاعاتتان را برگردانید. اگر پشتیبان ندارید، اطلاعات از بین می‌رود.</span></div>
      <button class="btn" data-action="lk-forgot-yes">پاک کردن اطلاعات و برداشتن قفل</button>
      <button class="btn ghost" data-action="lk-forgot-no">انصراف</button></div>`;
    return;
  }
  const wait = Math.max(0, Math.ceil((readFail().until - Date.now()) / 1000));
  const pattern = lock.kind === 'pattern';
  const msg = wait ? `چند بار اشتباه وارد شد. ${toFa(String(wait))} ثانیه صبر کنید.` : lk.msg;
  const bioBtn = lock.bio && lk.bioAvail ? '<button class="btn ghost" data-action="lk-bio">باز کردن با اثر انگشت</button>' : '';
  if (pattern) {
    lockEl.innerHTML = `<div class="lockscr">${brand}
      <div class="lk-title">الگو را بکشید</div>
      <div class="lk-msg" role="alert">${esc(msg)}</div>
      ${patternPadHtml('unlock', !!wait)}
      ${bioBtn}
      <button class="btn link" data-action="lk-forgot">الگو را فراموش کرده‌ام</button></div>`;
  } else {
    const dots = Array.from({ length: lock.len }, (_, i) => `<i class="${i < lk.entry.length ? 'on' : ''}"></i>`).join('');
    const key = (d: string) => `<button data-action="lk-digit" data-v="${d}" aria-label="${toFa(d)}"${wait ? ' disabled' : ''}>${toFa(d)}</button>`;
    const bio = lock.bio && lk.bioAvail ? '<button data-action="lk-bio" aria-label="اثر انگشت">☝︎</button>' : '<span></span>';
    lockEl.innerHTML = `<div class="lockscr">${brand}
      <div class="lk-title">رمز را وارد کنید</div>
      <div class="lk-dots" role="img" aria-label="${toFa(String(lk.entry.length))} رقم از ${toFa(String(lock.len))}">${dots}</div>
      <div class="lk-msg" role="alert">${esc(msg)}</div>
      <div class="lk-pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key).join('')}${bio}${key('0')}<button data-action="lk-del" aria-label="پاک کردن یک رقم">⌫</button></div>
      <button class="btn link" data-action="lk-forgot">رمز را فراموش کرده‌ام</button></div>`;
  }
  if (wait && lkTick === undefined) lkTick = window.setInterval(() => { renderLock(); if (readFail().until <= Date.now()) { window.clearInterval(lkTick); lkTick = undefined; } }, 1000);
}

function engageLock() {
  if (!store.settings.lock) return;
  lk.locked = true; lk.cover = false; lk.entry = ''; lk.msg = ''; lk.forgot = false;
  renderLock();
  if (store.settings.lock.bio && lk.bioAvail) window.setTimeout(() => toNative({ type: 'bio-auth', purpose: 'unlock' }), 350);
}

function unlockNow() {
  writeFail({ fails: 0, until: 0 });
  lk.locked = false; lk.cover = false; lk.entry = ''; lk.msg = '';
  renderLock();
  render();
}

async function lkSubmit(secret = lk.entry) {
  const lock = store.settings.lock;
  if (!lock || lk.busy) return;
  lk.busy = true;
  let ok = false;
  try { ok = await verifySecret(secret, lock); } finally { lk.busy = false; }
  if (ok) { unlockNow(); return; }
  const fails = readFail().fails + 1;
  const ms = lockoutMs(fails);
  writeFail({ fails, until: ms ? Date.now() + ms : 0 });
  lk.entry = '';
  lk.msg = ms ? '' : `${lock.kind === 'pattern' ? 'الگو' : 'رمز'} اشتباه است.${fails >= 3 ? ` ${toFa(String(5 - fails))} بار دیگر مجاز است.` : ''}`;
  renderLock();
}

function lkDigit(d: string) {
  const lock = store.settings.lock;
  if (!lock || !lk.locked || lk.busy || readFail().until > Date.now() || lk.entry.length >= lock.len) return;
  lk.entry += d;
  lk.msg = '';
  renderLock();
  if (lk.entry.length === lock.len) void lkSubmit();
}

/** برنامه به پس‌زمینه رفت یا برگشت (از اندروید یا مرورگر) */
function appVisibility(state: 'background' | 'active') {
  if (state === 'background' && secureMode) void flushSecure();
  const lock = store.settings.lock;
  if (!lock) return;
  if (state === 'background') {
    if (!lk.locked) { lk.hiddenAt = Date.now(); lk.cover = true; renderLock(); }
    return;
  }
  if (lk.locked) return;
  if (Date.now() - lk.hiddenAt >= (lock.after ?? DEFAULT_AUTO_LOCK) * 1000) engageLock();
  else { lk.cover = false; renderLock(); }
}

/* ------------------------------ صفحه‌ی الگو ------------------------------ */

/** اگر خط از روی نقطه‌ی میانیِ هنوز انتخاب‌نشده بگذرد، آن نقطه هم وارد الگو می‌شود (مثل قفل الگوی اندروید) */
const PAT_MID: Record<string, string> = { '13': '2', '31': '2', '46': '5', '64': '5', '79': '8', '97': '8', '17': '4', '71': '4', '28': '5', '82': '5', '39': '6', '93': '6', '19': '5', '91': '5', '37': '5', '73': '5' };
const patCenter = (n: number) => ({ x: (((n - 1) % 3) + 0.5) * (100 / 3), y: (Math.floor((n - 1) / 3) + 0.5) * (100 / 3) });

function patternPadHtml(id: string, disabled = false): string {
  const dots = Array.from({ length: 9 }, (_, i) => `<span class="pd" data-d="${i + 1}"></span>`).join('');
  return `<div class="pat${disabled ? ' off' : ''}" data-pad="${id}" role="group" aria-label="صفحه‌ی الگو؛ دست‌کم ${toFa(String(PATTERN_MIN))} نقطه را به‌هم وصل کنید"><svg viewBox="0 0 100 100" class="pat-svg" aria-hidden="true"><polyline points=""/></svg>${dots}</div>`;
}

let padState: { id: string; el: HTMLElement; seq: string } | null = null;

function padMove(ev: PointerEvent) {
  if (!padState) return;
  const r = padState.el.getBoundingClientRect();
  const px = ((ev.clientX - r.left) / r.width) * 100;
  const py = ((ev.clientY - r.top) / r.height) * 100;
  for (let n = 1; n <= 9; n++) {
    const c = patCenter(n);
    if (Math.hypot(px - c.x, py - c.y) > 11 || padState.seq.includes(String(n))) continue;
    const last = padState.seq.slice(-1);
    const mid = last ? PAT_MID[last + n] : undefined;
    if (mid && !padState.seq.includes(mid)) padState.seq += mid;
    padState.seq += String(n);
  }
  const pts = [...padState.seq].map((d) => patCenter(Number(d)));
  if (pts.length) pts.push({ x: Math.max(0, Math.min(100, px)), y: Math.max(0, Math.min(100, py)) });
  padState.el.querySelector('polyline')?.setAttribute('points', pts.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '));
  padState.el.querySelectorAll<HTMLElement>('.pd').forEach((d) => d.classList.toggle('on', padState!.seq.includes(d.dataset.d ?? '')));
}

function padEnd() {
  if (!padState) return;
  const { id, el, seq } = padState;
  padState = null;
  el.querySelector('polyline')?.setAttribute('points', [...seq].map((d) => `${patCenter(Number(d)).x.toFixed(1)},${patCenter(Number(d)).y.toFixed(1)}`).join(' '));
  window.setTimeout(() => {
    el.querySelector('polyline')?.setAttribute('points', '');
    el.querySelectorAll('.pd.on').forEach((d) => d.classList.remove('on'));
  }, 350);
  if (!seq) return;
  if (seq.length < PATTERN_MIN) {
    const m = `دست‌کم ${toFa(String(PATTERN_MIN))} نقطه را وصل کنید.`;
    if (id === 'unlock') { lk.msg = m; window.setTimeout(renderLock, 400); } else setErr(m);
    return;
  }
  if (id === 'unlock') void lkSubmit(seq);
  else void lockPatternStep(seq);
}

document.addEventListener('pointerdown', (ev) => {
  const el = (ev.target as HTMLElement).closest?.('.pat') as HTMLElement | null;
  if (!el || el.classList.contains('off')) return;
  ev.preventDefault();
  padState = { id: el.dataset.pad ?? '', el, seq: '' };
  try { el.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
  padMove(ev);
});
document.addEventListener('pointermove', (ev) => padMove(ev));
document.addEventListener('pointerup', padEnd);
document.addEventListener('pointercancel', padEnd);

function lockSection(): string {
  const l = store.settings.lock;
  if (!l) {
    return `<h2 class="section-title">قفل برنامه</h2>
    <div class="note info"><span>با قفل، هر بار که برنامه را باز می‌کنید (و پس از مدتی که از آن بیرون رفته‌اید) باید رمز عددی یا الگو را وارد کنید. این قفل جلوی دیدن اطلاعات توسط دیگران را می‌گیرد. قفل صفحه‌ی خود گوشی را هم نگه دارید.</span>
      <button class="btn" data-action="lock-open" data-v="enable">فعال کردن قفل</button></div>`;
  }
  return `<h2 class="section-title">قفل برنامه</h2>
    <div class="field"><span class="lab">قفل خودکار بعد از خروج از برنامه</span>${seg('set-autolock', String(l.after ?? DEFAULT_AUTO_LOCK), AUTO_LOCK_OPTIONS)}</div>
    <div class="note info"><span>قفل فعال است (${l.kind === 'pattern' ? 'الگو' : 'رمز عددی'}).</span>
      <div class="actions">
        ${lk.bioAvail ? `<button class="btn ghost" data-action="lock-bio">${l.bio ? 'خاموش کردن اثر انگشت' : 'روشن کردن اثر انگشت'}</button>` : ''}
        <button class="btn ghost" data-action="lock-open" data-v="change">تغییر رمز</button>
        <button class="btn ghost" data-action="lock-open" data-v="disable">خاموش کردن قفل</button>
      </div></div>`;
}

function widgetSection(): string {
  if (!inApp()) return '';
  const on = !!store.settings.widgetWorth;
  return `<h2 class="section-title">ویجت صفحه‌ی اصلی گوشی</h2>
    <div class="note info"><span>برای افزودن: روی صفحه‌ی اصلی گوشی نگه دارید، «ویجت‌ها» را بزنید و «دارا — قیمت‌های بازار» را بیاورید. قیمت‌هایی که در «نمای بازار» ستاره‌دار کرده‌اید نشان داده می‌شود و ویجت خودش هر حدود نیم‌ساعت قیمت را می‌گیرد؛ زمان آخرین قیمت دریافتی همیشه روی آن نوشته است.</span>
      <label class="check"><input type="checkbox" data-action="widget-worth" ${on ? 'checked' : ''}><span>سرمایه‌ی خالص هم روی ویجت نشان داده شود</span></label>
      ${on ? `<span class="hint">هرکس صفحه‌ی اصلی گوشی را ببیند مبلغ سرمایه‌ی شما را می‌بیند${store.settings.lock ? '، حتی با قفل برنامه' : ''}. اگر خودتان «پنهان کردن مبلغ‌ها» را روشن کنید، مبلغ از ویجت برداشته می‌شود.</span>` : '<span class="hint">پیش‌فرض خاموش است تا مبلغی روی صفحه‌ی اصلی دیده نشود.</span>'}
    </div>`;
}

function encSection(): string {
  if (!inApp()) return '';
  const on = secureMode && !!secureKey && !plainPending;
  const wait = secureMode && !!secureKey && plainPending;
  return `<h2 class="section-title">رمزنگاری اطلاعات</h2>
    <div class="note ${on ? 'info' : 'warn'}"><span>${on
      ? 'اطلاعات روی گوشی رمزنگاری‌شده ذخیره می‌شود (AES-256). کلید در بخش امن خود گوشی است و از آن بیرون نمی‌آید. اگر برنامه را پاک کنید یا گوشی را عوض کنید، فقط از «فایل پشتیبان» می‌توانید اطلاعات را برگردانید؛ پس پشتیبان بگیرید.'
      : wait ? 'در حال رمزنگاری اطلاعات…'
      : 'رمزنگاری روی این گوشی فعال نیست و اطلاعات به‌صورت معمولی نگه‌داری می‌شود.'}</span></div>`;
}

function disableLock() {
  delete store.settings.lock;
  save(); closeModal(); render(); renderLock();
  toast('قفل برنامه خاموش شد.');
}

async function lockPatternStep(seq: string) {
  if (modal?.kind !== 'lock') return;
  const f = modal.f;
  const cur = store.settings.lock;
  if (f.stage === 'cur') {
    if (!cur || !(await verifySecret(seq, cur))) return setErr('الگوی فعلی درست نیست.');
    f.curOk = true;
    f.error = '';
    if (f.mode === 'disable') return disableLock();
    f.stage = 'new';
    renderModal();
    return;
  }
  if (f.stage === 'new') {
    f.first = seq; f.stage = 'confirm'; f.error = '';
    renderModal();
    return;
  }
  if (seq !== f.first) {
    f.first = ''; f.stage = 'new'; f.error = 'دو الگو یکی نبود؛ دوباره از اول بکشید.';
    renderModal();
    return;
  }
  f.pin = seq; f.pin2 = seq;
  await lockSave();
}

async function lockSave() {
  if (modal?.kind !== 'lock') return;
  const f = modal.f;
  const cur = store.settings.lock;
  f.busy = true;
  try {
    if (f.mode !== 'enable' && !f.curOk && !(cur && (await verifySecret(f.cur, cur)))) return setErr('رمز فعلی درست نیست.');
    if (f.mode === 'disable') return disableLock();
    if (!isValidSecret(f.pin, f.kind)) return setErr(`رمز باید ${toFa(String(PIN_MIN))} تا ${toFa(String(PIN_MAX))} رقم (فقط عدد) باشد.`);
    if (normalizePin(f.pin) !== normalizePin(f.pin2)) return setErr('رمز و تکرار آن یکی نیست.');
    const rec = await hashSecret(f.pin, f.kind);
    store.settings.lock = { ...rec, bio: cur?.bio, after: cur?.after ?? DEFAULT_AUTO_LOCK };
    writeFail({ fails: 0, until: 0 });
    save(); closeModal(); render();
    toast(f.mode === 'enable' ? 'قفل برنامه فعال شد.' : f.kind === 'pattern' ? 'الگو تغییر کرد.' : 'رمز تغییر کرد.');
  } finally {
    f.busy = false;
  }
}

function viewSettings(): string {
  const s = store.settings;
  return `${header('تنظیمات')}
    <div class="field"><span class="lab">واحد پول نمایش</span>${seg('set-unit', s.unit, [['toman', 'تومان'], ['rial', 'ریال']])}
      <span class="hint">همه‌ی مبالغ به‌صورت ریال ذخیره می‌شوند و فقط نمایش عوض می‌شود.</span></div>
    <div class="field"><span class="lab">ظاهر برنامه</span>${seg('set-theme', s.theme, [['system', 'خودکار'], ['light', 'روشن'], ['dark', 'تاریک']])}</div>
    <div class="field"><span class="lab">اندازه‌ی نوشته‌ها</span>${seg('set-font', s.font, [['small', 'کوچک'], ['normal', 'معمولی'], ['large', 'بزرگ']])}</div>
    <h2 class="section-title">قیمت خودکار</h2>
    <div class="note info"><span>منبع: TGJU (طلا ۱۸ عیار، دلار، تتر). قیمت قدیمی، صفر یا جهش مشکوک رد می‌شود و آخرین قیمت معتبر می‌ماند.</span>
      <button class="btn link" data-action="paste-open">چسباندن پاسخ TGJU (برای امتحان)</button></div>
    ${updateSection()}
    <h2 class="section-title">پشتیبانی</h2>
    <div class="note info">
      <span>برای پرسش، گزارش خطا یا پیشنهاد، در تلگرام پیام بدهید:</span>
      <div class="actions">
        <a class="btn" href="${SUPPORT_URL}" target="_blank" rel="noopener noreferrer" data-action="support-open">باز کردن تلگرام</a>
        <button class="btn ghost" data-action="support-copy">کپی شناسه</button>
      </div>
    </div>
    ${lockSection()}
    ${encSection()}
    <h2 class="section-title">راهنما</h2>
    <div class="actions"><button class="btn ghost" data-action="onboard-open">نمایش دوباره‌ی راهنمای اول کار</button></div>
    <h2 class="section-title">گزارش و خروجی</h2>
    <div class="note info"><span>گزارش هر ماه شمسی و فایل CSV برای Excel. این فایل رمز ندارد؛ فقط برای کسی بفرستید که به آن اعتماد دارید.</span>
      <div class="actions"><button class="btn" data-action="report-open">گزارش ماهانه و خروجی</button></div></div>
    ${widgetSection()}
    <h2 class="section-title">گزارش برای خانواده</h2>
    <div class="note info"><span>یک خلاصه‌ی متنی و فقط‌خواندنی برای فرستادن به همسر یا فرزند. پیش‌فرض بدون مبلغ و بدون نام است و شما تعیین می‌کنید چه چیزی در آن بیاید.</span>
      <div class="actions"><button class="btn" data-action="family-open">ساخت گزارش خانواده</button></div></div>
    <h2 class="section-title">پشتیبان‌گیری</h2>
    <div class="note info"><span>${backupInfoHtml()}</span>
      <span>فایل پشتیبان با یک رمز که خودتان می‌گذارید قفل می‌شود و بدون آن رمز خوانده نمی‌شود. رمز جایی ذخیره یا فرستاده نمی‌شود؛ اگر فراموشش کنید پشتیبان باز نمی‌شود.</span>
      <div class="actions">
        <button class="btn" data-action="backup-open">ساخت و ارسال پشتیبان</button>
        <button class="btn ghost" data-action="restore-pick">بازیابی از فایل پشتیبان</button>
      </div>
      <input type="file" id="restore-file" hidden>
    </div>
    <h2 class="section-title">داده‌ها</h2>
    <div class="actions">
      <button class="btn ghost" data-action="ask" data-v="reset">بازگشت به داده‌ی آزمایشی</button>
      <button class="btn ghost" data-action="ask" data-v="clear">پاک کردن همه‌ی داده‌ها</button>
    </div>
    <div class="note info"><span>داده‌ها فقط روی همین دستگاه نگه‌داری می‌شوند؛ برای محافظت از آن‌ها پشتیبان بگیرید. </span></div>`;
}

/* ============================== رندر اصلی ============================== */

const appEl = document.getElementById('app') as HTMLElement;
const modalEl = document.getElementById('modal') as HTMLElement;
const toastEl = document.getElementById('toast') as HTMLElement;
const root = document.documentElement;
const hostTheme = root.getAttribute('data-theme');

function applySettings() {
  root.setAttribute('dir', 'rtl');
  root.setAttribute('lang', 'fa');
  root.setAttribute('data-font', store.settings.font);
  if (store.settings.theme === 'system') {
    if (hostTheme) root.setAttribute('data-theme', hostTheme);
    else root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', store.settings.theme);
  }
}

function render() {
  applySettings();
  const pf0 = computePortfolio(store.assets, store.txs, store.prices);
  const ce = cashEffect(peopleData());
  const pf: Portfolio = { ...pf0, cash: pf0.cash.plus(ce), totalValue: pf0.totalValue.plus(ce) };
  let body: string;
  if (view.assetId) body = viewAssetDetail(view.assetId, pf);
  else if (view.tab === 'home') body = view.market ? viewMarket() : viewHome(pf);
  else if (view.tab === 'assets') body = viewAssets(pf);
  else if (view.tab === 'txs') body = viewTxs();
  else if (view.tab === 'people') body = viewPeople();
  else body = viewSettings();
  appEl.innerHTML = `<div class="shell">${body}</div>${navHtml()}`;
  renderLock();
}

let toastTimer: number | undefined;
function toast(msg: string, undo?: () => void) {
  toastEl.innerHTML = `<div class="toast" role="status"><div class="in"><span>${esc(msg)}</span>${
    undo ? '<button data-action="undo">برگرداندن</button>' : ''
  }</div></div>`;
  undoFn = undo ?? null;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.innerHTML = '';
    undoFn = null;
  }, undo ? 9000 : 3500);
}
let undoFn: (() => void) | null = null;

function commit(txs: Tx[]) {
  store.txs = txs;
  save();
  render();
}

/* ============================== پنجره‌ها ============================== */

interface TxForm {
  mode: 'add' | 'edit';
  id?: string;
  step: 'form' | 'confirm';
  assetId: string;
  type: TxType;
  y: string; m: string; d: string;
  qty: string; price: string; fee: string; note: string;
  error: string;
}
interface IncomeForm {
  kind: IncomeKind; y: string; m: string; d: string; amount: string; source: string; note: string;
  /** کمک‌محاسبه‌ی سود روزشمار */
  principal: string; rate: string; fy: string; fm: string; fd: string; error: string;
}
function newIncomeForm(kind: IncomeKind = 'dividend'): IncomeForm {
  const t = jf(todayIso());
  const from = jf(addDaysIso(todayIso(), -30));
  return { kind, y: t.y, m: t.m, d: t.d, amount: '', source: '', note: '', principal: '', rate: '', fy: from.y, fm: from.m, fd: from.d, error: '' };
}
interface LoanForm {
  principal: string; rate: string; months: string; method: LoanMethod; fy: string; fm: string; fd: string;
  /** اگر قسط را می‌دانید و نرخ را نمی‌دانید */
  knownPay: string; error: string; result: LoanResult | null; implied: string;
}
function newLoanForm(): LoanForm {
  const n = jf(addJalaliMonths(todayIso(), 1));
  return { principal: '', rate: '', months: '', method: 'annuity', fy: n.y, fm: n.m, fd: n.d, knownPay: '', error: '', result: null, implied: '' };
}
interface PriceForm { assetId: string; price: string; error: string }
interface AssetForm {
  name: string; unit: string; decimals: string; preset: string; error: string;
  /** سهام بورس ایران: عبارت جست‌وجو، نتیجه‌ها، کد نماد در TSETMC و پیش‌نمایش قیمت */
  q: string; hits: InstrumentHit[]; insCode: string; preview: string; busy: boolean;
  /** اگر پر باشد، فرم فقط برای وصل کردن دارایی موجود به بورس است */
  linkId?: string;
}
const newAssetForm = (): AssetForm => ({
  name: '', unit: 'سهم', decimals: '0', preset: 'stock_ir', error: '', q: '', hits: [], insCode: '', preview: '', busy: false,
});

/** انواع آماده‌ی دارایی برای پر شدن خودکار واحد و رقم اعشار */
const ASSET_PRESETS: Record<string, { label: string; unit: string; decimals: string; kind: Asset['kind'] }> = {
  stock_ir: { label: 'سهام بورس ایران', unit: 'سهم', decimals: '0', kind: 'custom' },
  stock_world: { label: 'سهام یا صندوق خارجی', unit: 'سهم', decimals: '4', kind: 'custom' },
  crypto: { label: 'رمزارز', unit: 'عدد', decimals: '6', kind: 'crypto' },
  metal: { label: 'فلز یا سکه', unit: 'گرم', decimals: '3', kind: 'metal' },
  currency: { label: 'ارز', unit: 'واحد', decimals: '2', kind: 'currency' },
  other: { label: 'سایر (ملک، خودرو، …)', unit: 'عدد', decimals: '0', kind: 'custom' },
};

/** اگر فرم دارایی از داخل فرم معامله باز شده باشد، پس از ذخیره/انصراف به همان فرم برمی‌گردیم */
let pendingTx: TxForm | null = null;
/* ============================== یادآورها ============================== */

const BELL = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';

const remSettings = (): ReminderSettings => ({ ...DEFAULT_REMINDER_SETTINGS, ...(store.settings.rem ?? {}) });
const remList = (): Reminder[] => store.reminders ?? (store.reminders = []);
const personNameOf = (id: string) => store.people.find((p) => p.id === id)?.name ?? '';

/** همه‌ی رویدادهای تاریخی (قسط‌ها و یادآورهای تاریخ) به ترتیب سررسید */
function remEvents(horizon = 60): ReminderEvent[] {
  const today = todayIso();
  return [
    ...installmentEvents(store.debts, store.payments, personNameOf, remSettings(), today, horizon),
    ...dateEvents(remList(), today),
  ].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}
const firedUnseen = (): PriceReminder[] => remList().filter((r): r is PriceReminder => r.kind === 'price' && !!r.firedAt && !r.seen);
const remBadge = (): number => activeEvents(remEvents(), todayIso()).length + firedUnseen().length;

function dueBadge(due: string): string {
  const n = daysBetween(todayIso(), due);
  if (n < 0) return `<span class="badge loss">${toFa(String(-n))} روز گذشته</span>`;
  if (n === 0) return '<span class="badge buy">امروز</span>';
  if (n === 1) return '<span class="badge buy">فردا</span>';
  return `<span class="badge">${toFa(String(n))} روز دیگر</span>`;
}

function priceNote(r: PriceReminder): string {
  const t = `${ltr(fmtNum(fromRial(Decimal.of(r.target))))} ${unitLabel()}`;
  return `${r.side === 'sell' ? 'فروش' : 'خرید'} · وقتی قیمت به ${t} ${r.cond === 'above' ? 'یا بالاتر' : 'یا پایین‌تر'} رسید`;
}

/** همه‌ی قیمت‌های هدف را با آخرین قیمت‌ها می‌سنجد و هرکدام فقط یک بار اعلان می‌دهد */
function checkPriceAlerts() {
  let n = 0;
  for (const r of remList()) {
    if (r.kind !== 'price' || r.firedAt) continue;
    const p = store.prices[r.assetId];
    const price = p ? parseDec(p.price) : null;
    if (!p || !price) continue;
    // قیمت قدیمی (دستی یا خودکار) نباید هشدار کاذب ایجاد کند.
    const priceAt = Date.parse(p.at);
    if (!Number.isFinite(priceAt) || Date.now() - priceAt > 3 * 86_400_000) continue;
    if (!priceHit(r, price)) continue;
    r.firedAt = new Date().toISOString();
    r.seen = false;
    n += 1;
    toNative({
      type: 'notify-now',
      title: `${r.side === 'sell' ? 'وقت فروش' : 'وقت خرید'}: ${assetName(r.assetId)}`,
      body: `قیمت به ${fmtNum(fromRial(price))} ${unitLabel()} رسید. هدف شما: ${fmtNum(fromRial(Decimal.of(r.target)))}`,
    });
  }
  if (n) {
    save();
    if (!modal) render();
    toast(`${toFa(String(n))} هشدار قیمت فعال شد. زنگوله را بزنید.`);
  }
}

let noteTimer = 0;
function scheduleNoteSync() {
  if (!inApp()) return;
  window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => toNative({ type: 'notify-sync', notes: scheduleNotes(remEvents(), remSettings().hour) }), 600);
}

let remPerm: 'unknown' | 'granted' | 'denied' = 'unknown';

function remCard(): string {
  // تعهدات نزدیک و سررسیدهای گذشته را در خانه نشان می‌دهیم؛ نه فقط روزی که اعلان فعال می‌شود.
  const events = remEvents(60).slice(0, 3);
  const fired = firedUnseen();
  if (!events.length && !fired.length) return '';
  const rows = [
    ...fired.slice(0, 2).map((r) => `<div class="row rem-row"><div class="main"><span class="t">${r.side === 'sell' ? 'وقت فروش' : 'وقت خرید'}: ${esc(assetName(r.assetId))}</span><span class="s">${priceNote(r)}</span><span class="s">قیمت فعلی: ${store.prices[r.assetId] ? money(Decimal.of(store.prices[r.assetId].price)) : 'ثبت نشده'}</span></div><span class="badge buy">هشدار</span></div>`),
    ...events.map((e) => {
      const isInst = e.kind === 'installment';
      const action = isInst
        ? `<button class="btn link" data-action="rem-pay" data-v="${esc(e.id.split(':')[1])}">ثبت پرداخت</button>`
        : `<button class="btn link" data-action="rem-done" data-v="${esc(e.id.slice(5))}">انجام شد</button>`;
      return `<div class="row rem-row"><div class="main"><span class="t">${esc(e.title)}</span><span class="s">${dateFa(e.dueDate)}${e.amount ? ' · ' + money(Decimal.of(e.amount)) : ''}</span><span class="s rem-action">${action}</span></div>${dueBadge(e.dueDate)}</div>`;
    }),
  ];
  return `<section class="remcard card-rem" aria-label="تعهدات و هشدارها"><div class="between"><div><h2 class="section-title">تعهدات و هشدارها</h2><span class="rem-sub">قسط‌های نزدیک، سررسیدها و هشدارهای قیمت</span></div><button class="btn link" data-action="rem-open">مدیریت</button></div><div class="list">${rows.join('')}</div></section>`;
}

interface RemForm {
  view: 'list' | 'date' | 'price';
  title: string; note: string; y: string; m: string; d: string; lead: string;
  assetId: string; side: 'buy' | 'sell'; cond: 'above' | 'below'; target: string;
  error: string;
}
function newRemForm(view: RemForm['view']): RemForm {
  const j = jf(addDaysIso(todayIso(), 7));
  const a = store.assets.find((x) => x.id !== CASH_ID);
  return { view, title: '', note: '', ...j, lead: '1', assetId: a?.id ?? '', side: 'sell', cond: 'above', target: '', error: '' };
}

function remModalHtml(f: RemForm): string {
  const s = remSettings();
  if (f.view === 'date') {
    return sheet(`<h2>یادآور تاریخ</h2>
      <div class="field"><label for="r-title">برای چه چیزی؟</label>
        <input id="r-title" data-field="title" value="${esc(f.title)}" autocomplete="off" placeholder="مثلاً سررسید چک، اجاره، قسط خودرو"></div>
      <div class="field"><span class="lab">تاریخ (شمسی)</span>${dateFields(f.y, f.m, f.d, ['r-y', 'r-m', 'r-d'], ['y', 'm', 'd'])}</div>
      <div class="field"><span class="lab">چند روز زودتر یادآوری شود؟</span>${seg('rem-flead', f.lead, LEAD_OPTIONS.map((n) => [String(n), n ? toFa(String(n)) + ' روز' : 'همان روز'] as [string, string]))}</div>
      <div class="field"><label for="r-note">توضیح (اختیاری)</label><input id="r-note" data-field="note" value="${esc(f.note)}" autocomplete="off"></div>
      <div class="err" id="ferr" role="alert">${esc(f.error)}</div>
      <div class="actions"><button class="btn" data-action="rem-save-date">ذخیره</button><button class="btn ghost" data-action="rem-back">بازگشت</button></div>`);
  }
  if (f.view === 'price') {
    const opts = store.assets.filter((a) => a.id !== CASH_ID).map((a) => `<option value="${esc(a.id)}" ${a.id === f.assetId ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
    const cur = store.prices[f.assetId];
    return sheet(`<h2>هشدار قیمت</h2>
      <div class="field"><label for="r-asset">دارایی یا سهم</label><select id="r-asset" data-field="assetId">${opts}</select>
        <span class="hint">${cur ? `قیمت فعلی ثبت‌شده: ${money(Decimal.of(cur.price))}` : 'برای این مورد هنوز قیمتی ثبت نشده است.'} سهم تازه را اول از تب دارایی‌ها اضافه و به بورس وصل کنید.</span></div>
      <div class="field"><span class="lab">هدف</span>${seg('rem-side', f.side, [['sell', 'فروش'], ['buy', 'خرید']])}</div>
      <div class="field"><span class="lab">وقتی قیمت…</span>${seg('rem-cond', f.cond, [['above', 'بالاتر رفت'], ['below', 'پایین‌تر آمد']])}</div>
      <div class="field"><label for="r-target">قیمت هدف هر واحد (${unitLabel()})</label>
        <input id="r-target" data-field="target" inputmode="decimal" value="${esc(f.target)}" autocomplete="off"></div>
      <div class="note info"><span>هشدار قیمت پس از دریافت قیمت تازه یا باز شدن برنامه بررسی می‌شود. قیمت‌های قدیمی‌تر از ۳ روز برای فعال‌کردن هشدار معتبر نیستند؛ دریافت پیوسته‌ی قیمت در پس‌زمینه انجام نمی‌شود.</span></div>
      <div class="err" id="ferr" role="alert">${esc(f.error)}</div>
      <div class="actions"><button class="btn" data-action="rem-save-price">ذخیره</button><button class="btn ghost" data-action="rem-back">بازگشت</button></div>`);
  }
  const ev = remEvents();
  const evRows = ev.map((e) => {
    const isInst = e.kind === 'installment';
    const act = isInst
      ? `<button class="btn link" data-action="rem-pay" data-v="${esc(e.id.split(':')[1])}">ثبت پرداخت</button>`
      : `<button class="btn link" data-action="rem-done" data-v="${esc(e.id.slice(5))}">انجام شد</button><button class="btn link bad" data-action="rem-del" data-v="${esc(e.id.slice(5))}">حذف</button>`;
    return `<div class="row"><div class="main"><span class="t">${esc(e.title)}</span>
      <span class="s">${dateFa(e.dueDate)}${e.amount ? ' · ' + money(Decimal.of(e.amount)) : ''}${e.body && !isInst ? ' · ' + esc(e.body) : ''}</span>
      <span class="s">${act}</span></div>${dueBadge(e.dueDate)}</div>`;
  }).join('');
  const prices = remList().filter((r): r is PriceReminder => r.kind === 'price').map((r) => {
    const p = store.prices[r.assetId];
    return `<div class="row"><div class="main"><span class="t">${esc(assetName(r.assetId))}</span>
      <span class="s">${priceNote(r)}</span>
      <span class="s">${p ? 'قیمت فعلی: ' + money(Decimal.of(p.price)) + ' · ' + priceLabel(p) : 'قیمت فعلی ثبت نشده'}</span>
      <span class="s rem-action">${r.firedAt ? `<button class="btn link" data-action="rem-rearm" data-v="${esc(r.id)}">فعال‌سازی مجدد</button>` : '<span class="muted">با به‌روزرسانی قیمت بررسی می‌شود</span>'}<button class="btn link bad" data-action="rem-del" data-v="${esc(r.id)}">حذف</button></span></div>
      <span class="badge ${r.firedAt ? 'buy' : ''}">${r.firedAt ? 'فعال‌شده' : 'در انتظار'}</span></div>`;
  }).join('');
  const perm = !inApp()
    ? '<div class="note info"><span>اعلان گوشی فقط در برنامه‌ی اندروید کار می‌کند. در این نسخه‌ی وب، یادآورها فقط داخل صفحه دیده می‌شوند.</span></div>'
    : remPerm === 'granted' ? ''
    : '<div class="note"><span>اجازه‌ی اعلان داده نشده است، پس یادآورها فقط داخل برنامه دیده می‌شوند. اگر دکمه کار نکرد، از تنظیمات اندروید برای این برنامه «اعلان‌ها» را روشن کنید.</span><button class="btn" data-action="rem-perm">اجازه‌ی اعلان</button></div>';
  return sheet(`<h2>یادآورها</h2>${perm}
    <div class="actions"><button class="btn" data-action="rem-new-date">یادآور تاریخ</button><button class="btn" data-action="rem-new-price">هشدار قیمت</button></div>
    <h2 class="section-title">قسط‌ها و تاریخ‌ها</h2>
    <div class="list">${evRows || '<div class="empty">در ۶۰ روز آینده چیزی نیست.</div>'}</div>
    <h2 class="section-title">هشدار قیمت خرید و فروش</h2>
    <div class="list">${prices || '<div class="empty">هشداری نگذاشته‌اید.</div>'}</div>
    <h2 class="section-title">تنظیم</h2>
    <div class="field"><span class="lab">یادآوری خودکار قسط‌های ثبت‌شده</span>${seg('rem-inst', s.installments ? '1' : '0', [['1', 'روشن'], ['0', 'خاموش']])}</div>
    <div class="field"><span class="lab">قسط‌ها چند روز زودتر یادآوری شوند؟</span>${seg('rem-ilead', String(s.installmentLead), LEAD_OPTIONS.map((n) => [String(n), n ? toFa(String(n)) : 'همان روز'] as [string, string]))}</div>
    <div class="field"><span class="lab">ساعت اعلان</span>${seg('rem-hour', String(s.hour), [8, 9, 12, 18].map((h) => [String(h), toFa(String(h)) + ':۰۰'] as [string, string]))}</div>
    <div class="actions"><button class="btn ghost" data-action="close">بستن</button></div>`);
}

function openReminders() {
  modal = { kind: 'rem', f: newRemForm('list') };
  // مشاهده‌ی هشدارهای قیمت = دیده‌شده
  let ch = false;
  for (const r of remList()) if (r.kind === 'price' && r.firedAt && !r.seen) { r.seen = true; ch = true; }
  if (ch) { save(); render(); }
  renderModal();
  toNative({ type: 'notify-perm' });
}

function saveDateReminder() {
  if (modal?.kind !== 'rem') return;
  const f = modal.f;
  const date = jalaliToIso(Number(toEn(f.y)), Number(toEn(f.m)), Number(toEn(f.d)));
  if (!date) return setErr('تاریخ شمسی معتبر نیست.');
  const r: Reminder = { id: nid('r'), kind: 'date', title: f.title.trim(), date, leadDays: Number(f.lead), ...(f.note.trim() ? { note: f.note.trim() } : {}) };
  const err = validateReminder(r);
  if (err) return setErr(err);
  remList().push(r);
  save();
  modal = { kind: 'rem', f: newRemForm('list') };
  renderModal();
  render();
  toNative({ type: 'notify-perm', ask: true });
  toast('یادآور ذخیره شد.');
}

function savePriceReminder() {
  if (modal?.kind !== 'rem') return;
  const f = modal.f;
  const n = parseField('قیمت هدف', f.target);
  if (typeof n === 'string') return setErr(n);
  const r: PriceReminder = { id: nid('r'), kind: 'price', assetId: f.assetId, side: f.side, cond: f.cond, target: toRialDec(n).toString() };
  const err = validateReminder(r);
  if (err) return setErr(err);
  const cur = store.prices[f.assetId];
  const curD = cur ? parseDec(cur.price) : null;
  if (curD && priceHit(r, curD)) return setErr('قیمت فعلی همین حالا به این هدف رسیده است. هدف دیگری بگذارید.');
  remList().push(r);
  save();
  modal = { kind: 'rem', f: newRemForm('list') };
  renderModal();
  toNative({ type: 'notify-perm', ask: true });
  toast('هشدار قیمت ذخیره شد.');
}

type Modal =
  | { kind: 'tx'; f: TxForm }
  | { kind: 'price'; f: PriceForm }
  | { kind: 'asset'; f: AssetForm }
  | { kind: 'debt'; f: DebtForm }
  | { kind: 'pay'; f: PayForm }
  | { kind: 'check'; f: ChequeForm }
  | { kind: 'quote'; key: string }
  | { kind: 'paste'; f: { text: string; error: string } }
  | { kind: 'prices'; results: PriceResult[]; errors: { provider: string; message: string }[] }
  | { kind: 'ask'; what: 'reset' | 'clear' }
  | { kind: 'recover' }
  | { kind: 'lock'; f: { mode: 'enable' | 'change' | 'disable'; kind: LockKind; stage: 'cur' | 'new' | 'confirm'; first: string; curOk: boolean; cur: string; pin: string; pin2: string; error: string; busy: boolean } }
  | { kind: 'rem'; f: RemForm }
  | { kind: 'infl'; f: { v: string; error: string } }
  | { kind: 'income'; f: IncomeForm }
  | { kind: 'report'; f: { y: number; m: number } }
  | { kind: 'family'; f: FamilyOpts }
  | { kind: 'loan'; f: LoanForm }
  | { kind: 'onboard'; f: { step: number } }
  | { kind: 'backup'; f: { pass: string; pass2: string; error: string; busy: boolean } }
  | { kind: 'restore'; f: { text: string; pass: string; error: string; busy: boolean; stage: 'pass' | 'confirm'; parsed: Store | null; at: string } }
  | null;
let modal: Modal = null;

function closeModal() {
  modal = null;
  pendingTx = null;
  modalEl.innerHTML = '';
  // تا وقتی تصمیم بازیابی گرفته نشده، پنجره‌ی بازیابی بسته نمی‌ماند
  if (writesBlocked) {
    modal = { kind: 'recover' };
    renderModal();
  }
}

const ONBOARD: { title: string; body: string; icon: string }[] = [
  { icon: '◈', title: 'به دارا خوش آمدید', body: 'دارایی‌ها، بدهی‌ها، طلب‌ها و چک‌هایتان را یک‌جا ببینید و سود و زیانتان را بدانید. اطلاعات فقط روی گوشی شما می‌ماند، رمزنگاری می‌شود و جایی فرستاده نمی‌شود. این راهنما چند صفحه‌ی کوتاه است و بعداً از «تنظیمات» دوباره باز می‌شود.' },
  { icon: '①', title: 'از کجا شروع کنم؟', body: 'اول موجودی نقد را با «واریز نقد» ثبت کنید. بعد هر خرید یا فروش (طلا، دلار، سهام و…) را از تب «معاملات» با «ثبت خرید» و «ثبت فروش» وارد کنید. هر چیز را می‌توانید بعداً ویرایش یا حذف کنید و ثبت اشتباه هم هشدار می‌دهد.' },
  { icon: '②', title: 'قیمت‌ها از کجا می‌آید؟', body: 'قیمت طلا، دلار و ارزها خودکار از اینترنت می‌آید. سهام را در «دارایی‌ها ← افزودن دارایی» به بورس وصل می‌کنید. برنامه هیچ قیمتی نمی‌سازد: منبع و زمان هر قیمت دیده می‌شود، قیمت دستی برچسب «دستی» دارد و اگر قیمتی قدیمی باشد هشدار می‌دهد.' },
  { icon: '③', title: 'خانه: سرمایه‌ی خالص و روند', body: 'بالای خانه سرمایه‌ی خالص (نقد + دارایی‌ها + طلب‌ها − بدهی‌ها) را می‌بینید. روی نمودار روند بزنید یا انگشت را بکشید تا مقدار و تغییر هر نقطه را ببینید؛ بازه را (روز، هفته، ماه…) عوض کنید. با آیکون چشم، مبلغ‌ها پنهان می‌شود. «نمای بازار» هم قیمت‌های ستاره‌دار شما را نشان می‌دهد.' },
  { icon: '④', title: 'دارایی‌ها: ترکیب، سود و زیان', body: 'تب «دارایی‌ها» ترکیب دارایی‌ها، سهم هرکدام از سرمایه و درصد سود و زیانشان را نشان می‌دهد. «سود واقعی» می‌گوید در مقایسه با نگه‌داشتن دلار، طلا یا تورم چه بوده است؛ نرخ تورم را خودتان وارد می‌کنید و قیمت تاریخی ساخته نمی‌شود. با ثبت «سود سهام و سپرده» درآمدتان هم حساب می‌شود.' },
  { icon: '⑤', title: 'اشخاص، وام و چک', body: 'در تب «اشخاص» قرض‌ها، وام‌ها و اقساط را ثبت کنید و پرداخت هر قسط را بزنید. چک‌های دریافتی و پرداختی با سررسید ثبت می‌شوند و در سرمایه‌ی خالص حساب می‌شوند. ماشین‌حساب وام هم قسط ماهانه را برایتان حساب می‌کند.' },
  { icon: '⑥', title: 'یادآور و اعلان', body: 'از زنگ بالای خانه، یادآور سررسید قسط و چک، یادآور تاریخ دلخواه و هشدار قیمت خرید یا فروش بسازید. اعلان‌ها را در تنظیمات گوشی اجازه دهید. هشدار قیمت وقتی بررسی می‌شود که برنامه باز باشد یا قیمت‌ها به‌روز شوند.' },
  { icon: '⑦', title: 'گزارش، خروجی و ویجت', body: 'از «تنظیمات» گزارش ماهانه و خروجی Excel بگیرید یا خلاصه‌ی فقط‌خواندنی (بدون مبلغ و نام، مگر خودتان بخواهید) برای خانواده بفرستید. ویجت «دارا — قیمت‌های بازار» را هم می‌توانید روی صفحه‌ی اصلی گوشی بگذارید.' },
  { icon: '⑧', title: 'اطلاعات را امن نگه دارید', body: 'در «تنظیمات» قفل رمز، الگو یا اثر انگشت بگذارید و حتماً پشتیبان بگیرید. چون اطلاعات رمزنگاری‌شده روی گوشی است، اگر برنامه پاک شود یا گوشی عوض شود فقط فایل پشتیبان آن را برمی‌گرداند. پشتیبان را جایی امن نگه دارید.' },
];

function finishOnboard() {
  store.settings.onboarded = true;
  save();
  closeModal();
}

function sheet(inner: string): string {
  return `<div class="scrim" data-action="scrim"><div class="sheet" role="dialog" aria-modal="true">${inner}</div></div>`;
}

const optionsFor = (cash: boolean): TxType[] => (cash ? ['deposit', 'withdraw'] : ['buy', 'sell', 'receive']);

/** قیمت روز ثبت‌شده را به‌عنوان پیشنهاد در فرم می‌گذارد (قابل تغییر) */
function suggestPrice(assetId: string): string {
  const pr = store.prices[assetId];
  return assetId !== CASH_ID && pr ? rialToField(pr.price) : '';
}

function newTxForm(assetId: string, type: TxType): TxForm {
  const aid = assetId || store.assets[0]?.id || CASH_ID;
  const cash = aid === CASH_ID;
  const j = isoToJalali(todayIso())!;
  return {
    mode: 'add', step: 'form', assetId: aid,
    type: optionsFor(cash).includes(type) ? type : optionsFor(cash)[0],
    y: toFa(String(j.y)), m: toFa(String(j.m)), d: toFa(String(j.d)),
    qty: '', price: suggestPrice(aid), fee: '', note: '', error: '',
  };
}

function editTxForm(tx: Tx): TxForm {
  const j = isoToJalali(tx.date)!;
  const cash = tx.assetId === CASH_ID;
  return {
    mode: 'edit', id: tx.id, step: 'form', assetId: tx.assetId, type: tx.type,
    y: toFa(String(j.y)), m: toFa(String(j.m)), d: toFa(String(j.d)),
    qty: cash ? rialToField(tx.quantity) : plainField(parseDec(tx.quantity) ?? Decimal.ZERO),
    price: cash ? '' : rialToField(tx.unitPrice),
    fee: cash ? '' : rialToField(tx.fee),
    note: tx.note ?? '', error: '',
  };
}

function parseField(label: string, raw: string): Decimal | string {
  const s = toEn(raw);
  if (s === '') return `${label} را وارد کنید.`;
  try {
    return Decimal.parse(s);
  } catch {
    return `${label} باید عدد باشد.`;
  }
}

/** فرم → پیش‌نویس معامله (ریالی) یا پیام خطا */
function buildDraft(f: TxForm): { draft: TxDraft } | { error: string } {
  const cash = f.assetId === CASH_ID;
  const asset = assetById(f.assetId);
  if (!cash && !asset) return { error: 'دارایی را انتخاب کنید.' };

  const date = jalaliToIso(Number(toEn(f.y)), Number(toEn(f.m)), Number(toEn(f.d)));
  if (!date) return { error: 'تاریخ شمسی معتبر نیست. سال، ماه و روز را بررسی کنید.' };

  const q = parseField(cash ? 'مبلغ' : 'مقدار', f.qty);
  if (typeof q === 'string') return { error: q };
  if (q.lte(0)) return { error: cash ? 'مبلغ باید بیشتر از صفر باشد.' : 'مقدار باید بیشتر از صفر باشد.' };

  if (cash) {
    const rial = toRialDec(q);
    if (!rial.isInteger()) return { error: 'مبلغ نقد باید بدون اعشار (به ریال) باشد.' };
    return { draft: { assetId: CASH_ID, type: f.type, date, quantity: rial.toString(), unitPrice: '1', fee: '0', note: f.note.trim() || undefined } };
  }

  if (!q.mul(Decimal.of(10n ** BigInt(asset!.decimals))).isInteger()) {
    return { error: `مقدار «${asset!.name}» حداکثر ${toFa(String(asset!.decimals))} رقم اعشار دارد.` };
  }
  const p = parseField('قیمت هر واحد', f.price);
  if (typeof p === 'string') return { error: p };
  if (p.lte(0)) return { error: 'قیمت هر واحد باید بیشتر از صفر باشد.' };
  const feeRaw = f.type === 'receive' || f.fee.trim() === '' ? Decimal.ZERO : parseField('کارمزد', f.fee);
  if (typeof feeRaw === 'string') return { error: feeRaw };
  if (feeRaw.isNegative()) return { error: 'کارمزد نمی‌تواند منفی باشد.' };

  return {
    draft: {
      assetId: f.assetId, type: f.type, date,
      quantity: q.toString(), unitPrice: toRialDec(p).toString(), fee: toRialDec(feeRaw).toString(),
      note: f.note.trim() || undefined,
    },
  };
}

function liveTotal(f: TxForm): string {
  const r = buildDraft(f);
  if ('error' in r) return '—';
  const d = r.draft;
  const q = parseDec(d.quantity)!;
  const p = parseDec(d.unitPrice)!;
  const fee = parseDec(d.fee)!;
  const gross = q.mul(p);
  return money(d.type === 'buy' ? gross.plus(fee) : d.type === 'sell' ? gross.minus(fee) : gross);
}

function txFormHtml(f: TxForm): string {
  const cash = f.assetId === CASH_ID;
  const asset = assetById(f.assetId);
  const title = f.mode === 'edit' ? 'ویرایش معامله' : 'ثبت معامله';
  const assetOpts = [
    ...store.assets.map((a) => `<option value="${esc(a.id)}" ${a.id === f.assetId ? 'selected' : ''}>${esc(a.name)}</option>`),
    `<option value="${CASH_ID}" ${cash ? 'selected' : ''}>وجه نقد</option>`,
    '<option value="__new">＋ دارایی جدید (سهام، رمزارز، …)</option>',
  ].join('');
  const totalLabel = f.type === 'sell' ? 'دریافتی خالص' : f.type === 'buy' ? 'هزینه‌ی کل با کارمزد' : f.type === 'receive' ? 'ارزش دریافتی' : 'مبلغ';
  return sheet(`
    <h2>${title}</h2>
    <div class="field"><label for="f-asset">دارایی</label>
      <select id="f-asset" data-field="assetId">${assetOpts}</select></div>
    <div class="field"><span class="lab">نوع عملیات</span>
      <div class="seg">${optionsFor(cash)
        .map((t) => `<button data-action="set-type" data-v="${t}" aria-pressed="${f.type === t}">${TYPE_LABEL[t]}</button>`)
        .join('')}</div></div>
    <div class="field"><span class="lab">تاریخ (شمسی)</span>
      <div class="three">
        <input id="f-y" data-field="y" inputmode="numeric" value="${esc(f.y)}" aria-label="سال">
        <input id="f-m" data-field="m" inputmode="numeric" value="${esc(f.m)}" aria-label="ماه">
        <input id="f-d" data-field="d" inputmode="numeric" value="${esc(f.d)}" aria-label="روز">
      </div></div>
    <div class="field"><label for="f-qty">${cash ? `مبلغ (${unitLabel()})` : `مقدار (${esc(asset?.unit ?? '')})`}</label>
      <input id="f-qty" data-field="qty" inputmode="decimal" value="${esc(f.qty)}" autocomplete="off"></div>
    ${
      cash
        ? ''
        : `<div class="field"><label for="f-price">${f.type === 'receive' ? `ارزش هر ${esc(asset?.unit ?? 'واحد')} در روز دریافت` : `قیمت هر ${esc(asset?.unit ?? 'واحد')}`} (${unitLabel()})</label>
            <input id="f-price" data-field="price" inputmode="decimal" value="${esc(f.price)}" autocomplete="off"></div>
           ${
             f.type === 'receive'
               ? ''
               : `<div class="field"><label for="f-fee">کارمزد یا هزینه‌ی جانبی (${unitLabel()}، اختیاری)</label>
            <input id="f-fee" data-field="fee" inputmode="decimal" value="${esc(f.fee)}" autocomplete="off"></div>`
           }
           <div class="field"><span class="hint">${
             f.type === 'receive'
               ? 'هدیه یا دریافتی: فقط مقدار این دارایی زیاد می‌شود و وجه نقد شما دست نمی‌خورد. ارزش روز دریافت برای محاسبه‌ی سود و زیان بعدی استفاده می‌شود.'
               : 'وجه نقد شما با این معامله تغییر نمی‌کند؛ نقد و دارایی‌ها جدا حساب می‌شوند.'
           }</span></div>`
    }
    <div class="field"><label for="f-note">توضیحات (اختیاری)</label>
      <input id="f-note" data-field="note" value="${esc(f.note)}" autocomplete="off"></div>
    <div class="live"><span class="muted">${totalLabel}</span><span class="v" id="live">${liveTotal(f)}</span></div>
    <div class="err" id="ferr" role="alert">${esc(f.error)}</div>
    <div class="actions"><button class="btn" data-action="form-next">ادامه و بررسی</button>
      <button class="btn ghost" data-action="close">انصراف</button></div>`);
}

function simulate(f: TxForm): { res: ChangeResult; draft: TxDraft } | { error: string } {
  const b = buildDraft(f);
  if ('error' in b) return b;
  const res = f.mode === 'edit' && f.id ? updateTx(store.txs, f.id, b.draft) : addTx(store.txs, b.draft);
  return { res, draft: b.draft };
}

function confirmHtml(f: TxForm): string {
  const sim = simulate(f);
  if ('error' in sim) {
    return sheet(`<h2>خطا</h2><div class="err">${esc(sim.error)}</div><div class="actions"><button class="btn" data-action="form-back">بازگشت و اصلاح</button></div>`);
  }
  const { res, draft } = sim;
  if (!res.ok) {
    const msgs = [...new Set(res.issues.filter((i) => i.severity === 'error').map((i) => i.message))];
    return sheet(`<h2>این معامله ثبت نمی‌شود</h2>
      ${msgs.map((m) => `<div class="err">${esc(m)}</div>`).join('')}
      <div class="actions"><button class="btn" data-action="form-back">بازگشت و اصلاح</button></div>`);
  }
  const cash = draft.assetId === CASH_ID;
  const q = parseDec(draft.quantity)!;
  const p = parseDec(draft.unitPrice)!;
  const fee = parseDec(draft.fee)!;
  const gross = q.mul(p);
  const total = draft.type === 'buy' ? gross.plus(fee) : draft.type === 'sell' ? gross.minus(fee) : gross;
  const asset = assetById(draft.assetId);
  const rows: string[] = [
    `<div class="row"><span>عملیات</span><b>${TYPE_LABEL[draft.type]} ${esc(assetName(draft.assetId))}</b></div>`,
    `<div class="row"><span>تاریخ</span><b>${dateFa(draft.date)}</b></div>`,
  ];
  if (!cash && asset) {
    rows.push(`<div class="row"><span>مقدار</span><b>${qty(q, asset)}</b></div>`);
    rows.push(`<div class="row"><span>قیمت هر ${esc(asset.unit)}</span><b>${money(p)}</b></div>`);
    rows.push(`<div class="row"><span>مبلغ بدون کارمزد</span><b>${money(gross)}</b></div>`);
    if (draft.type !== 'receive') rows.push(`<div class="row"><span>کارمزد</span><b>${money(fee)}</b></div>`);
  }
  rows.push(`<div class="row"><span>${draft.type === 'sell' ? 'دریافتی خالص' : draft.type === 'buy' ? 'هزینه‌ی کل' : draft.type === 'receive' ? 'ارزش دریافتی' : 'مبلغ'}</span><b>${money(total)}</b></div>`);

  const after = res.txs;
  const newTx = f.mode === 'edit' ? after.find((t) => t.id === f.id) : after.find((t) => !store.txs.some((o) => o.id === t.id));
  if (!cash && asset && newTx) {
    const st = computeAssetState(asset.id, after);
    const before = computeAssetState(asset.id, store.txs);
    const row = st.rows.find((r) => r.txId === newTx.id);
    rows.push(`<div class="row"><span>موجودی پس از ثبت</span><b>${qty(st.quantity, asset)}</b></div>`);
    rows.push(`<div class="row"><span>میانگین قیمت خرید (قبل ← بعد)</span><b>${money(before.avgCost, false)} ← ${money(st.avgCost)}</b></div>`);
    if (row?.realizedPnl) rows.push(`<div class="row"><span>سود یا زیان این فروش</span><b>${pnl(row.realizedPnl)}</b></div>`);
    rows.push(`<div class="row"><span>وجه نقد</span><b>بدون تغییر (${money(computeCash(after).balance)})</b></div>`);
  }
  const warns = [...new Set(res.issues.filter((i) => i.severity === 'warning').map((i) => i.message))];
  return sheet(`<h2>تأیید نهایی</h2>
    <div class="summary">${rows.join('')}</div>
    ${warns.map((w) => `<div class="note"><span>${esc(w)}</span></div>`).join('')}
    <div class="actions"><button class="btn" data-action="form-submit">ثبت نهایی</button>
      <button class="btn ghost" data-action="form-back">بازگشت و اصلاح</button></div>`);
}

function renderModal() {
  if (!modal) {
    modalEl.innerHTML = '';
    return;
  }
  if (modal.kind === 'recover') {
    modalEl.innerHTML = sheet(`<h2>اطلاعات ذخیره‌شده خوانده نشد</h2>
      <div class="note"><span>داده‌ی قبلی خراب است. یک کپی از آن کنار گذاشته شد و تا تصمیم شما هیچ‌چیز پاک یا بازنویسی نمی‌شود.</span></div>
      <div class="actions">
        ${recoverMirror ? '<button class="btn" data-action="recover-mirror">بازیابی از نسخه‌ی خودکار گوشی</button>' : ''}
        <button class="btn" data-action="recover-file">بازیابی از فایل پشتیبان</button>
        <button class="btn ghost bad" data-action="recover-empty">شروع با اطلاعات خالی</button>
      </div><input type="file" id="restore-file" hidden>`);
    return;
  }
  if (modal.kind === 'onboard') {
    const i = Math.min(modal.f.step, ONBOARD.length - 1);
    const p = ONBOARD[i];
    const last = i === ONBOARD.length - 1;
    modalEl.innerHTML = sheet(`<div class="onb">
      <div class="onb-ic" aria-hidden="true">${p.icon}</div>
      <h2>${p.title}</h2>
      <p>${p.body}</p>
      <div class="onb-dots" aria-label="صفحه ${toFa(String(i + 1))} از ${toFa(String(ONBOARD.length))}">${ONBOARD.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div>
      <div class="actions">
        ${last ? '<button class="btn" data-action="onboard-done">شروع کنید</button>' : '<button class="btn" data-action="onboard-next">بعدی</button>'}
        ${i > 0 ? '<button class="btn ghost" data-action="onboard-prev">قبلی</button>' : ''}
        ${last ? '' : '<button class="btn link" data-action="onboard-done">رد کردن</button>'}
      </div></div>`);
    return;
  }
  if (modal.kind === 'loan') {
    const f = modal.f;
    const r = f.result;
    const rows = r ? r.rows.map((x) => `<tr><td>${toFa(String(x.index))}</td><td>${x.date ? ltr(toFa(formatJalali(x.date))) : ''}</td><td>${money(x.payment, false)}</td><td>${money(x.interest, false)}</td><td>${money(x.principal, false)}</td><td>${money(x.balance, false)}</td></tr>`).join('') : '';
    modalEl.innerHTML = sheet(`<h2>ماشین‌حساب وام و قسط</h2>
      <div class="field"><span class="lab">روش محاسبه‌ی سود</span>${seg('loan-method', f.method, [['annuity', 'کاهشی (روی مانده)'], ['flat', 'ثابت (بانکی)']])}</div>
      <div class="field"><label for="ln-p">مبلغ وام (${unitLabel()})</label><input id="ln-p" data-field="principal" inputmode="decimal" value="${esc(f.principal)}" autocomplete="off"></div>
      <div class="field"><label for="ln-r">نرخ سود سالانه (درصد)</label><input id="ln-r" data-field="rate" inputmode="decimal" value="${esc(f.rate)}" autocomplete="off"></div>
      <div class="field"><label for="ln-m">تعداد قسط (ماه)</label><input id="ln-m" data-field="months" inputmode="numeric" value="${esc(f.months)}" autocomplete="off"></div>
      <div class="field"><span class="lab">تاریخ قسط اول (شمسی)</span>${dateFields(f.fy, f.fm, f.fd, ['ln-fy', 'ln-fm', 'ln-fd'], ['fy', 'fm', 'fd'])}</div>
      <div class="err" id="ferr" role="alert">${esc(f.error)}</div>
      <div class="actions"><button class="btn" data-action="loan-calc">محاسبه</button></div>
      ${r ? `<div class="tile">
        <div class="between rr"><span>قسط ماهانه</span><b>${money(r.payment)}</b></div>
        <div class="between rr"><span>مجموع بازپرداخت</span><b>${money(r.totalPaid)}</b></div>
        <div class="between rr"><span>مجموع سود</span><b>${money(r.totalInterest)}</b></div></div>
        <div class="tablewrap"><table class="loantbl"><thead><tr><th>#</th><th>تاریخ</th><th>قسط</th><th>سود</th><th>اصل</th><th>مانده</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="actions"><button class="btn" data-action="loan-save">ثبت در تعهدات</button></div>` : ''}
      <div class="note info"><span><b>قسط را می‌دانید ولی نرخ را نه؟</b> مبلغ وام و تعداد قسط را بالا بنویسید، قسط ماهانه را اینجا بگذارید تا نرخ سالانه‌ی مؤثر (کاهشی) تقریب زده شود.</span>
        <div class="field"><label for="ln-k">قسط ماهانه (${unitLabel()})</label><input id="ln-k" data-field="knownPay" inputmode="decimal" value="${esc(f.knownPay)}" autocomplete="off"></div>
        <div class="actions"><button class="btn ghost" data-action="loan-rate">تخمین نرخ</button></div>
        ${f.implied ? `<span><b>${esc(f.implied)}</b></span>` : ''}</div>
      <div class="actions"><button class="btn ghost" data-action="close">بستن</button></div>`);
    return;
  }
  if (modal.kind === 'family') {
    const f = modal.f;
    modalEl.innerHTML = sheet(`<h2>گزارش برای خانواده</h2>
      <label class="check"><input type="checkbox" data-field="amounts" ${f.amounts ? 'checked' : ''}><span>مبلغ‌ها نمایش داده شود</span></label>
      <label class="check"><input type="checkbox" data-field="names" ${f.names ? 'checked' : ''}><span>نام اشخاص و صاحبان چک نمایش داده شود</span></label>
      <label class="check"><input type="checkbox" data-field="commitments" ${f.commitments ? 'checked' : ''}><span>قسط‌ها و چک‌های ۳۰ روز آینده</span></label>
      <pre class="famprev" id="fam-prev" dir="rtl">${esc(familyText(f))}</pre>
      <div class="actions"><button class="btn" data-action="family-share">ارسال گزارش</button>
        <button class="btn ghost" data-action="family-copy">کپی متن</button>
        <button class="btn ghost" data-action="close">بستن</button></div>`);
    return;
  }
  if (modal.kind === 'report') {
    const { y, m } = modal.f;
    const rg = monthRange(y, m);
    const r = rg ? monthReport(store.assets, store.txs, rg.from, rg.to, store.history ?? []) : null;
    const row = (k: string, v: string) => `<div class="between rr"><span>${k}</span><b>${v}</b></div>`;
    const sgn = (d: Decimal) => `<span class="${d.gt(0) ? 'gain' : d.isNegative() ? 'loss' : ''}">${money(d)}</span>`;
    modalEl.innerHTML = sheet(`<h2>گزارش ماهانه</h2>
      <div class="between"><button class="btn ghost" data-action="report-nav" data-v="-1" aria-label="ماه قبل">‹ قبل</button>
        <b>${toFa(monthTitle(y, m))}</b>
        <button class="btn ghost" data-action="report-nav" data-v="1" aria-label="ماه بعد">بعد ›</button></div>
      ${r ? `<div class="tile">
        ${row('تعداد معاملات', toFa(String(r.txCount)))}
        ${row('مجموع خرید', money(r.bought))}
        ${row('مجموع فروش (خالص)', money(r.sold))}
        ${row('کارمزدها', money(r.fees))}
        ${row('سود یا زیان فروش‌ها', sgn(r.realized))}
        ${row('سود دریافتی (سهام، سپرده، روزشمار)', money(r.income.total))}
        ${row('واریز نقد', money(r.cashIn))}
        ${row('برداشت نقد', money(r.cashOut))}
        ${r.worthStart && r.worthEnd ? row('سرمایه‌ی اول ← آخر ماه', `${money(r.worthStart, false)} ← ${money(r.worthEnd, false)}`) : ''}
      </div>` : '<div class="empty">ماه معتبر نیست.</div>'}
      <span class="hint">فایل CSV را Excel و Google Sheets باز می‌کنند. مبلغ‌ها در فایل به ریال هستند.</span>
      <div class="actions">
        <button class="btn" data-action="report-csv" data-v="month">خروجی تراکنش‌های این ماه</button>
        <button class="btn ghost" data-action="report-csv" data-v="all">خروجی همه‌ی تراکنش‌ها</button>
        <button class="btn ghost" data-action="report-csv" data-v="summary">خروجی خلاصه‌ی ماه</button>
        <button class="btn ghost" data-action="close">بستن</button></div>`);
    return;
  }
  if (modal.kind === 'income') {
    const f = modal.f;
    const kinds = (Object.keys(INCOME_LABEL) as IncomeKind[]).map((k): [string, string] => [k, INCOME_LABEL[k]]);
    const accr = f.kind === 'accrual';
    modalEl.innerHTML = sheet(`<h2>ثبت سود دریافتی</h2>
      <div class="field"><span class="lab">نوع سود</span>${seg('income-kind', f.kind, kinds)}</div>
      <div class="field"><label for="in-src">${f.kind === 'dividend' ? 'نام سهم' : 'نام بانک یا حساب'} (اختیاری)</label>
        <input id="in-src" data-field="source" value="${esc(f.source)}" autocomplete="off"></div>
      ${accr ? `<div class="note info"><span>کمک‌محاسبه: سود روزشمار = اصل پول × نرخ سالانه × تعداد روز ÷ ۳۶۵ (از تاریخ شروع تا تاریخ دریافت).</span></div>
        <div class="field"><label for="in-pr">اصل پول (${unitLabel()})</label><input id="in-pr" data-field="principal" inputmode="decimal" value="${esc(f.principal)}" autocomplete="off"></div>
        <div class="field"><label for="in-rt">نرخ سود سالانه (درصد)</label><input id="in-rt" data-field="rate" inputmode="decimal" value="${esc(f.rate)}" autocomplete="off"></div>
        <div class="field"><span class="lab">تاریخ شروع (شمسی)</span>${dateFields(f.fy, f.fm, f.fd, ['in-fy', 'in-fm', 'in-fd'], ['fy', 'fm', 'fd'])}</div>
        <div class="actions"><button class="btn ghost" data-action="income-calc">محاسبه‌ی مبلغ سود</button></div>` : ''}
      <div class="field"><span class="lab">تاریخ دریافت (شمسی)</span>${dateFields(f.y, f.m, f.d, ['in-y', 'in-m', 'in-d'], ['y', 'm', 'd'])}</div>
      <div class="field"><label for="in-am">مبلغ سود دریافتی (${unitLabel()})</label>
        <input id="in-am" data-field="amount" inputmode="decimal" value="${esc(f.amount)}" autocomplete="off">
        <span class="hint">مبلغ به نقد شما اضافه می‌شود و جزو درآمد حساب می‌شود، نه آورده‌ی سرمایه.</span></div>
      <div class="err" id="ferr" role="alert">${esc(f.error)}</div>
      <div class="actions"><button class="btn" data-action="income-save">ذخیره</button>
        <button class="btn ghost" data-action="close">انصراف</button></div>`);
    return;
  }
  if (modal.kind === 'infl') {
    modalEl.innerHTML = sheet(`<h2>نرخ تورم سالانه</h2>
      <div class="field"><label for="i-v">نرخ تورم سالانه (درصد)</label>
        <input id="i-v" data-field="v" inputmode="decimal" value="${esc(modal.f.v)}" autocomplete="off">
        <span class="hint">این عدد را خودتان از منبع معتبر (مثلاً مرکز آمار یا بانک مرکزی) وارد می‌کنید؛ برنامه آن را حدس نمی‌زند.</span></div>
      <div class="err" id="ferr" role="alert">${esc(modal.f.error)}</div>
      <div class="actions"><button class="btn" data-action="infl-save">ذخیره</button>
        ${typeof store.settings.inflation === 'number' ? '<button class="btn ghost" data-action="infl-clear">حذف نرخ</button>' : ''}
        <button class="btn ghost" data-action="close">انصراف</button></div>`);
    return;
  }
  if (modal.kind === 'tx') {
    modalEl.innerHTML = modal.f.step === 'form' ? txFormHtml(modal.f) : confirmHtml(modal.f);
  } else if (modal.kind === 'price') {
    const a = assetById(modal.f.assetId);
    const cur = store.prices[modal.f.assetId];
    modalEl.innerHTML = sheet(`<h2>قیمت روز ${esc(a?.name ?? '')}</h2>
      <div class="field"><label for="p-price">قیمت هر ${esc(a?.unit ?? 'واحد')} (${unitLabel()})</label>
        <input id="p-price" data-field="price" inputmode="decimal" value="${esc(modal.f.price)}" autocomplete="off">
        <span class="hint">این قیمت دستی است. دریافت خودکار قیمت در مرحله‌ی سوم اضافه می‌شود.</span></div>
      <div class="err" id="ferr" role="alert">${esc(modal.f.error)}</div>
      <div class="actions"><button class="btn" data-action="price-save">ذخیره</button>
        ${cur ? '<button class="btn ghost" data-action="price-clear">حذف قیمت</button>' : ''}
        <button class="btn ghost" data-action="close">انصراف</button></div>`);
  } else if (modal.kind === 'asset' && modal.f.linkId) {
    modalEl.innerHTML = sheet(`<h2>اتصال ${esc(assetById(modal.f.linkId)?.name ?? '')} به بورس</h2>
      ${stockSearchHtml(modal.f)}
      <div class="err" id="ferr" role="alert">${esc(modal.f.error)}</div>
      <div class="actions"><button class="btn" data-action="stock-link-save">ذخیره‌ی اتصال</button>
        <button class="btn ghost" data-action="close">انصراف</button></div>`);
  } else if (modal.kind === 'asset') {
    const assetDecimals = modal.f.decimals;
    const presetSel = modal.f.preset;
    modalEl.innerHTML = sheet(`<h2>افزودن دارایی</h2>
      <div class="note info"><span>قیمت هر دارایی را بعد از افزودن، با «ثبت قیمت» خودتان وارد می‌کنید. برای نقره، سکه، ارزها و رمزارزها بهتر است از «نمای بازار» روی همان قیمت بزنید تا قیمت خودکار هم وصل شود. قیمت همه‌ی دارایی‌ها به ریال یا تومان ثبت می‌شود (برای سهام خارجی، معادل تومانی را وارد کنید).</span></div>
      <div class="field"><label for="a-preset">نوع دارایی</label>
        <select id="a-preset" data-field="preset">${Object.entries(ASSET_PRESETS)
          .map(([k, v]) => `<option value="${k}" ${k === presetSel ? 'selected' : ''}>${esc(v.label)}</option>`)
          .join('')}</select></div>
      ${modal.f.preset === 'stock_ir' ? stockSearchHtml(modal.f) : ''}
      <div class="field"><label for="a-name">نام دارایی (مثلاً فملی)</label><input id="a-name" data-field="name" value="${esc(modal.f.name)}" autocomplete="off"></div>
      <div class="field"><label for="a-unit">واحد شمارش (مثلاً سهم، گرم، عدد)</label><input id="a-unit" data-field="unit" value="${esc(modal.f.unit)}" autocomplete="off"></div>
      <div class="field"><label for="a-dec">حداکثر رقم اعشار مقدار</label>
        <select id="a-dec" data-field="decimals">${[0, 1, 2, 3, 4, 6, 8]
          .map((n) => `<option value="${n}" ${String(n) === assetDecimals ? 'selected' : ''}>${toFa(String(n))}</option>`)
          .join('')}</select></div>
      <div class="err" id="ferr" role="alert">${esc(modal.f.error)}</div>
      <div class="actions"><button class="btn" data-action="asset-save">افزودن</button>
        <button class="btn ghost" data-action="close">انصراف</button></div>`);
  } else if (modal.kind === 'quote') {
    const key = modal.key;
    const e = mk().entries.find((x) => x.key === key);
    if (!e) {
      closeModal();
      return;
    }
    const meta = classify(e.key);
    const stale = isStale(e, marketRef());
    const row = (k: string, v: string) => `<div class="row"><span>${k}</span><b>${v}</b></div>`;
    const rows: string[] = [row('قیمت', fmtVal(meta, e.price))];
    if (meta.unit === 'irr') {
      const d = Decimal.parse(e.price);
      rows.push(isToman()
        ? row('به ریال', ltr(fmtNum(d)) + ' <span class="u">ریال</span>')
        : row('به تومان', ltr(fmtNum(d.div(10))) + ' <span class="u">تومان</span>'));
    }
    if (meta.per) rows.push(row('واحد شمارش', esc(meta.per)));
    if (e.high) rows.push(row('بیشترین', fmtVal(meta, e.high)));
    if (e.low) rows.push(row('کمترین', fmtVal(meta, e.low)));
    rows.push(row('تغییر', changeHtml(e) + (e.change && e.dir && e.change !== '0' ? ` (${fmtVal(meta, e.change)})` : '')));
    rows.push(row('زمان قیمت', entryTime(e)));
    rows.push(row('کلید در TGJU', `<bdi dir="ltr">${esc(e.key)}</bdi>`));
    const unitNote = meta.unit === 'irr' ? 'منبع این قیمت را به ریال می‌دهد.'
      : meta.unit === 'usd' ? 'منبع این قیمت را به دلار می‌دهد.'
      : 'واحد این مورد در منبع مشخص نیست؛ عدد همان‌طور که منبع داده نشان داده می‌شود.';
    modalEl.innerHTML = sheet(`<h2>${esc(meta.title)}</h2>
      ${stale ? '<div class="note"><span>این قیمت از تازه‌ترین قیمت‌های این فهرست خیلی عقب‌تر است و برای حساب مالی استفاده نمی‌شود.</span></div>' : ''}
      <div class="summary">${rows.join('')}</div>
      <div class="note info"><span>${unitNote}</span></div>
      <div class="actions">${
        meta.unit === 'irr' && !meta.per && !stale
          ? store.assets.some((a) => a.priceKeys?.tgju === e.key || DEFAULT_PRICE_KEYS.tgju?.[a.id] === e.key)
            ? '<span class="muted">این مورد در فهرست دارایی‌های شما هست.</span>'
            : `<button class="btn" data-action="add-from-market" data-v="${esc(e.key)}">افزودن به دارایی‌ها</button>`
          : ''
      }<button class="btn ghost" data-action="close">بستن</button></div>`);
  } else if (modal.kind === 'paste') {
    modalEl.innerHTML = sheet(`<h2>چسباندن پاسخ TGJU</h2>
      <div class="note info"><span>آدرس <bdi dir="ltr">https://call.tgju.org/ajax.json</bdi> را در مرورگر باز کنید، همه‌ی متن را کپی کنید و اینجا بچسبانید. اپ اندروید این مرحله را خودش انجام می‌دهد.</span></div>
      <div class="field"><label for="paste-text">متن پاسخ</label>
        <textarea id="paste-text" data-field="text" rows="7" dir="ltr" autocomplete="off" spellcheck="false">${esc(modal.f.text)}</textarea></div>
      <div class="err" id="ferr" role="alert">${esc(modal.f.error)}</div>
      <div class="actions"><button class="btn" data-action="paste-apply">اعمال قیمت‌ها</button>
        <button class="btn ghost" data-action="close">انصراف</button></div>`);
  } else if (modal.kind === 'lock') {
    const f = modal.f;
    const m = f.mode;
    const existing = store.settings.lock;
    const title = m === 'enable' ? 'فعال کردن قفل' : m === 'change' ? 'تغییر قفل' : 'خاموش کردن قفل';
    const field = (id: string, key: string, label: string, val: string) =>
      `<div class="field"><label for="${id}">${label}</label><input id="${id}" data-field="${key}" type="password" inputmode="numeric" maxlength="${PIN_MAX}" autocomplete="off" value="${esc(val)}"></div>`;
    const cancel = '<button class="btn ghost" data-action="close">انصراف</button>';
    const err = `<div class="err" id="ferr" role="alert">${esc(f.error)}</div>`;
    let inner: string;
    if (f.stage === 'cur' && existing?.kind === 'pattern') {
      inner = `<h2>${title}</h2><div class="hint">الگوی فعلی را بکشید.</div><div class="pad-wrap">${patternPadHtml('lc')}</div>${err}<div class="actions">${cancel}</div>`;
    } else if (f.stage === 'new' || f.stage === 'confirm') {
      const kindSeg = m === 'disable' ? '' : `<div class="field"><span class="lab">نوع قفل</span>${seg('lock-kind', f.kind, [['pin', 'رمز عددی'], ['pattern', 'الگو']])}</div>`;
      if (m === 'disable') {
        inner = `<h2>${title}</h2>${field('lc-cur', 'cur', 'رمز فعلی', f.cur)}${err}<div class="actions"><button class="btn" data-action="lock-save"${f.busy ? ' disabled' : ''}>خاموش کردن</button>${cancel}</div>`;
      } else if (f.kind === 'pattern') {
        inner = `<h2>${title}</h2>${kindSeg}<div class="hint">${f.stage === 'new' ? `الگوی جدید را بکشید (دست‌کم ${toFa(String(PATTERN_MIN))} نقطه).` : 'همان الگو را دوباره بکشید.'}</div><div class="pad-wrap">${patternPadHtml('lc')}</div>${err}<div class="actions">${cancel}</div>`;
      } else {
        inner = `<h2>${title}</h2>${kindSeg}
          ${m === 'change' && existing?.kind !== 'pattern' ? field('lc-cur', 'cur', 'رمز فعلی', f.cur) : ''}
          ${field('lc-pin', 'pin', `رمز جدید (${toFa(String(PIN_MIN))} تا ${toFa(String(PIN_MAX))} رقم)`, f.pin)}${field('lc-pin2', 'pin2', 'تکرار رمز جدید', f.pin2)}
          ${m === 'enable' ? '<div class="note info"><span>رمز یا الگو را فراموش نکنید. اگر فراموش شود، فقط با پاک کردن اطلاعات برنامه می‌توان قفل را برداشت و باید از پشتیبان بازیابی کنید.</span></div>' : ''}
          ${err}<div class="actions"><button class="btn" data-action="lock-save"${f.busy ? ' disabled' : ''}>ذخیره</button>${cancel}</div>`;
      }
    } else {
      inner = `<h2>${title}</h2>${err}<div class="actions">${cancel}</div>`;
    }
    modalEl.innerHTML = sheet(inner);
  } else if (modal.kind === 'check') {
    modalEl.innerHTML = chequeFormHtml(modal.f);
  } else if (modal.kind === 'rem') {
    modalEl.innerHTML = remModalHtml(modal.f);
  } else if (modal.kind === 'backup') {
    modalEl.innerHTML = sheet(`<h2>ساخت فایل پشتیبان</h2>
      <div class="note info"><span>برای پشتیبان یک رمز بگذارید. بعد از ساخت، منوی اشتراک‌گذاری اندروید باز می‌شود و می‌توانید فایل را برای جیمیل خودتان بفرستید. رمز را به همراه فایل نفرستید و جای امنی یادداشت کنید.</span></div>
      <div class="field"><label for="bk-pass">رمز پشتیبان</label>
        <input id="bk-pass" data-field="pass" type="password" autocomplete="new-password" value="${esc(modal.f.pass)}"></div>
      <div class="field"><label for="bk-pass2">تکرار رمز</label>
        <input id="bk-pass2" data-field="pass2" type="password" autocomplete="new-password" value="${esc(modal.f.pass2)}"></div>
      <div class="err" id="ferr" role="alert">${esc(modal.f.error)}</div>
      <div class="actions"><button class="btn" data-action="backup-make"${modal.f.busy ? ' disabled' : ''}>ساخت و ارسال</button>
        <button class="btn ghost" data-action="close">انصراف</button></div>`);
  } else if (modal.kind === 'restore') {
    const st = modal.f.parsed;
    modalEl.innerHTML = sheet(
      modal.f.stage === 'pass'
        ? `<h2>بازیابی از پشتیبان</h2>
      <div class="field"><label for="rs-pass">رمز این فایل پشتیبان</label>
        <input id="rs-pass" data-field="pass" type="password" autocomplete="off" value="${esc(modal.f.pass)}"></div>
      <div class="err" id="ferr" role="alert">${esc(modal.f.error)}</div>
      <div class="actions"><button class="btn" data-action="restore-check"${modal.f.busy ? ' disabled' : ''}>باز کردن پشتیبان</button>
        <button class="btn ghost" data-action="close">انصراف</button></div>`
        : `<h2>جایگزینی اطلاعات</h2>
      <div class="note"><span>این پشتیبان${modal.f.at ? ' (ساخته‌شده در ' + dateFa(modal.f.at.slice(0, 10)) + ')' : ''} شامل ${toFa(String(st?.assets.length ?? 0))} دارایی، ${toFa(String(st?.txs.length ?? 0))} تراکنش و ${toFa(String(st?.people.length ?? 0))} شخص است. با ادامه، همه‌ی اطلاعات فعلی برنامه با آن جایگزین می‌شود.</span></div>
      <div class="actions"><button class="btn" data-action="restore-apply">جایگزین کن</button>
        <button class="btn ghost" data-action="close">انصراف</button></div>`,
    );
  } else if (modal.kind === 'prices') {
    const LABEL: Record<string, string> = {
      updated: 'به‌روز شد', unchanged: 'بدون تغییر', 'no-key': 'دستی', missing: 'پیدا نشد',
      stale: 'قدیمی', invalid: 'نامعتبر', suspicious: 'مشکوک', failed: 'ناموفق',
    };
    const done = modal.results.filter((r) => r.status === 'updated').length;
    const rows = modal.results
      .map((r) => `<div class="row"><div class="main"><span class="t">${esc(assetName(r.assetId))}</span><span class="s">${esc(r.message)}</span></div>
        <span class="badge ${r.status === 'updated' ? 'buy' : ''}">${LABEL[r.status] ?? r.status}</span></div>`)
      .join('');
    const errs = modal.errors.map((e) => `<div class="note"><span><b>${esc(e.provider)}:</b> ${esc(e.message)}</span></div>`).join('');
    modalEl.innerHTML = sheet(`<h2>نتیجه‌ی به‌روزرسانی قیمت‌ها</h2>
      <div class="note info"><span>${done ? `${toFa(String(done))} قیمت به‌روز شد.` : 'هیچ قیمتی تغییر نکرد. قیمت‌های قبلی همان‌طور که بودند ماندند.'}</span></div>
      ${errs}
      <div class="list">${rows}</div>
      ${modal.errors.length ? `<div class="note info"><span>در این نمونه‌ی وب مرورگر معمولاً اجازه‌ی اتصال مستقیم به TGJU را نمی‌دهد. با چسباندن پاسخ می‌توانید همان منطق را امتحان کنید.</span>
        <button class="btn link" data-action="paste-open">چسباندن پاسخ TGJU</button></div>` : ''}
      <div class="actions"><button class="btn" data-action="close">بستن</button></div>`);
  } else if (modal.kind === 'debt') {
    modalEl.innerHTML = debtFormHtml(modal.f);
  } else if (modal.kind === 'pay') {
    modalEl.innerHTML = payFormHtml(modal.f);
  } else {
    const reset = modal.what === 'reset';
    modalEl.innerHTML = sheet(`<h2>${reset ? 'بازگشت به داده‌ی آزمایشی' : 'پاک کردن همه‌ی داده‌ها'}</h2>
      <div class="note"><span>${reset ? 'همه‌ی معاملات و قیمت‌های فعلی با داده‌ی آزمایشی جایگزین می‌شوند.' : 'همه‌ی معاملات و قیمت‌ها پاک می‌شوند و فقط دارایی‌های پیش‌فرض می‌مانند. این کار برگشت‌پذیر نیست.'}</span></div>
      <div class="actions"><button class="btn danger" data-action="ask-yes" data-v="${modal.what}">${reset ? 'جایگزین کن' : 'پاک کن'}</button>
        <button class="btn ghost" data-action="close">انصراف</button></div>`);
  }
}

/* ============================== رویدادها ============================== */

function openTxForm(assetId: string, type: TxType) {
  modal = { kind: 'tx', f: newTxForm(assetId, type) };
  renderModal();
}

document.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!el) return;
  const act = el.dataset.action as string;
  const v = el.dataset.v ?? '';

  if (act === 'scrim') {
    if (ev.target === el) closeModal();
    return;
  }
  switch (act) {
    case 'history-range':
      if (['1d', '1w', '1m', '3m', '6m', '1y', 'all'].includes(v)) view.historyRange = v as typeof view.historyRange;
      render();
      break;
    case 'lock-open': {
      const mode = v as 'enable' | 'change' | 'disable';
      const needCurPad = mode !== 'enable' && store.settings.lock?.kind === 'pattern';
      modal = { kind: 'lock', f: { mode, kind: 'pin', stage: needCurPad ? 'cur' : 'new', first: '', curOk: false, cur: '', pin: '', pin2: '', error: '', busy: false } };
      renderModal();
      break;
    }
    case 'lock-kind':
      if (modal?.kind === 'lock' && (v === 'pin' || v === 'pattern')) {
        Object.assign(modal.f, { kind: v, stage: 'new', first: '', pin: '', pin2: '', error: '' });
        renderModal();
      }
      break;
    case 'lock-save':
      void lockSave();
      break;
    case 'set-autolock':
      if (store.settings.lock && AUTO_LOCK_OPTIONS.some(([k]) => k === v)) {
        store.settings.lock.after = Number(v);
        save();
        render();
      }
      break;
    case 'lock-bio':
      if (store.settings.lock?.bio) {
        store.settings.lock.bio = false;
        save();
        render();
      } else {
        toNative({ type: 'bio-auth', purpose: 'enable' });
      }
      break;
    case 'lk-digit':
      lkDigit(v);
      break;
    case 'lk-del':
      lk.entry = lk.entry.slice(0, -1);
      lk.msg = '';
      renderLock();
      break;
    case 'lk-bio':
      toNative({ type: 'bio-auth', purpose: 'unlock' });
      break;
    case 'lk-forgot':
      lk.forgot = true;
      renderLock();
      break;
    case 'lk-forgot-no':
      lk.forgot = false;
      renderLock();
      break;
    case 'lk-forgot-yes': {
      const st = { ...store.settings };
      delete st.lock;
      store = emptyStore(st, mk());
      try { localStorage.removeItem('hooman-finance-before-restore'); } catch { /* ignore */ }
      lk.forgot = false;
      save();
      unlockNow();
      toast('اطلاعات پاک و قفل برداشته شد. می‌توانید از پشتیبان بازیابی کنید.');
      break;
    }
    case 'backup-open':
      modal = { kind: 'backup', f: { pass: '', pass2: '', error: '', busy: false } };
      renderModal();
      break;
    case 'backup-make':
      void makeBackup();
      break;
    case 'restore-pick':
      (document.getElementById('restore-file') as HTMLInputElement | null)?.click();
      break;
    case 'restore-check':
      void restoreCheck();
      break;
    case 'restore-apply':
      restoreApply();
      break;
    case 'fav': {
      const cur = favKeys();
      store.settings.favs = cur.includes(v) ? cur.filter((k) => k !== v) : [...cur, v];
      save();
      render();
      break;
    }
    case 'market-open':
      view.market = true;
      render();
      window.scrollTo(0, 0);
      break;
    case 'quote':
      modal = { kind: 'quote', key: v };
      renderModal();
      break;
    case 'mcat':
      view.mcat = v as CategoryId | 'all';
      render();
      break;
    case 'mstale':
      view.mstale = !view.mstale;
      render();
      break;
    case 'tab':
      view.tab = v as Tab;
      view.person = null;
      view.assetId = null;
      view.market = false;
      render();
      window.scrollTo(0, 0);
      break;
    case 'open-asset':
      view.assetId = v;
      render();
      window.scrollTo(0, 0);
      break;
    case 'back':
      if (view.person && view.tab === 'people') view.person = null;
      else if (view.assetId) view.assetId = null;
      else view.market = false;
      render();
      break;
    case 'filter':
      view.filter = v;
      render();
      break;
    case 'new-tx':
      openTxForm(el.dataset.asset ?? '', (el.dataset.type as TxType) ?? 'buy');
      break;
    case 'edit-tx': {
      const tx = store.txs.find((t) => t.id === v);
      if (tx) {
        modal = { kind: 'tx', f: editTxForm(tx) };
        renderModal();
      }
      break;
    }
    case 'del-tx': {
      const r = deleteTx(store.txs, v, new Date().toISOString());
      if (!r.ok) {
        toast(r.issues[0]?.message ? `حذف ممکن نیست: ${r.issues[0].message}` : 'حذف ممکن نیست.');
        break;
      }
      commit(r.txs);
      toast('معامله حذف شد. می‌توانید آن را برگردانید.', () => {
        const back = restoreTx(store.txs, v);
        if (back.ok) commit(back.txs);
      });
      break;
    }
    case 'restore-tx': {
      const r = restoreTx(store.txs, v);
      if (r.ok) {
        commit(r.txs);
        toast('معامله بازگردانی شد.');
      } else toast(`بازگردانی ممکن نیست: ${r.issues[0]?.message ?? ''}`);
      break;
    }
    case 'undo':
      if (undoFn) undoFn();
      toastEl.innerHTML = '';
      undoFn = null;
      break;
    case 'price': {
      const cur = store.prices[v];
      modal = { kind: 'price', f: { assetId: v, price: cur ? rialToField(cur.price) : '', error: '' } };
      renderModal();
      break;
    }
    case 'price-save': {
      if (modal?.kind !== 'price') break;
      const n = parseField('قیمت', modal.f.price);
      if (typeof n === 'string') return setErr(n);
      if (n.lte(0)) return setErr('قیمت باید بیشتر از صفر باشد.');
      store.prices[modal.f.assetId] = {
        assetId: modal.f.assetId, price: toRialDec(n).toString(), source: 'manual', at: new Date().toISOString(),
      };
      save();
      closeModal();
      render();
      toast('قیمت روز ذخیره شد.');
      checkPriceAlerts();
      break;
    }
    case 'onboard-open':
      modal = { kind: 'onboard', f: { step: 0 } };
      renderModal();
      break;
    case 'onboard-next':
      if (modal?.kind === 'onboard') { modal.f.step = Math.min(ONBOARD.length - 1, modal.f.step + 1); renderModal(); }
      break;
    case 'onboard-prev':
      if (modal?.kind === 'onboard') { modal.f.step = Math.max(0, modal.f.step - 1); renderModal(); }
      break;
    case 'onboard-done':
      finishOnboard();
      render();
      break;
    case 'loan-open':
      modal = { kind: 'loan', f: newLoanForm() };
      renderModal();
      break;
    case 'loan-method':
      if (modal?.kind === 'loan') { modal.f.method = v === 'flat' ? 'flat' : 'annuity'; modal.f.result = null; renderModal(); }
      break;
    case 'loan-calc': {
      if (modal?.kind !== 'loan') break;
      const f = modal.f;
      const pr = parseField('مبلغ وام', f.principal);
      if (typeof pr === 'string') return setErr(pr);
      const rt = parseField('نرخ سود', f.rate);
      if (typeof rt === 'string') return setErr(rt);
      const months = Number(toEn(f.months));
      const principal = toRialDec(pr);
      const bad = validateLoan(principal, rt, months);
      if (bad) return setErr(bad);
      const first = jalaliToIso(Number(toEn(f.fy)), Number(toEn(f.fm)), Number(toEn(f.fd))) ?? undefined;
      f.result = computeLoan(principal, rt, months, f.method, first);
      f.error = '';
      renderModal();
      break;
    }
    case 'loan-rate': {
      if (modal?.kind !== 'loan') break;
      const f = modal.f;
      const pr = parseField('مبلغ وام', f.principal);
      if (typeof pr === 'string') return setErr(pr);
      const pay = parseField('قسط ماهانه', f.knownPay);
      if (typeof pay === 'string') return setErr(pay);
      const months = Number(toEn(f.months));
      const rate = impliedAnnualRate(toRialDec(pr).toNumber(), toRialDec(pay).toNumber(), months);
      f.error = '';
      f.implied = rate === null ? 'با این اعداد نرخی پیدا نشد؛ مجموع اقساط باید کمتر از مبلغ وام نباشد.'
        : `نرخ سالانه‌ی مؤثر تقریباً ${toFa(rate.toFixed(2)).replace('.', '٫')}٪ (روش کاهشی)`;
      renderModal();
      break;
    }
    case 'loan-save': {
      if (modal?.kind !== 'loan' || !modal.f.result) break;
      const f = modal.f;
      const r = f.result!;
      const d = newDebtForm('borrowed');
      d.title = 'وام';
      // بدهی با اقساط یعنی مجموع بازپرداخت (اصل + سود)، نه فقط مبلغ دریافتی
      const owed = r.totalPaid.gte(r.payment.mul(r.rows.length)) ? r.totalPaid : r.payment.mul(r.rows.length);
      d.amount = rialToField(owed.toString());
      d.note = `وام ${money(toRialDec(parseField('مبلغ وام', f.principal) as Decimal), false)}؛ مبلغ ثبت‌شده مجموع بازپرداخت با سود است.`.replace(/<[^>]*>/g, '');
      d.plan = true;
      d.count = toFa(String(r.rows.length));
      d.installment = rialToField(r.payment.toString());
      d.every = '۱';
      d.fy = f.fy; d.fm = f.fm; d.fd = f.fd;
      modal = { kind: 'debt', f: d };
      renderModal();
      break;
    }
    case 'widget-worth':
      store.settings.widgetWorth = !store.settings.widgetWorth;
      save(); render();
      break;
    case 'family-open':
      modal = { kind: 'family', f: { amounts: false, names: false, commitments: true } };
      renderModal();
      break;
    case 'family-share':
      if (modal?.kind === 'family') exportFile(`dara-family-${todayIso()}.txt`, familyText(modal.f), 'text/plain');
      break;
    case 'family-copy':
      if (modal?.kind === 'family') {
        const text = familyText(modal.f);
        void navigator.clipboard?.writeText(text).then(() => toast('متن گزارش کپی شد.'), () => toast('کپی ممکن نشد.'));
      }
      break;
    case 'report-open': {
      const j = isoToJalali(todayIso())!;
      modal = { kind: 'report', f: { y: j.y, m: j.m } };
      renderModal();
      break;
    }
    case 'report-nav':
      if (modal?.kind === 'report') {
        const n = shiftMonth(modal.f.y, modal.f.m, Number(v));
        if (n.y >= 1300 && n.y <= 1500) { modal.f = n; renderModal(); }
      }
      break;
    case 'report-csv': {
      if (modal?.kind !== 'report') break;
      const { y, m } = modal.f;
      const rg = monthRange(y, m);
      if (!rg) break;
      const stamp = `${y}-${String(m).padStart(2, '0')}`;
      if (v === 'all') exportFile(`dara-transactions-all.csv`, txCsv(store.assets, store.txs));
      else if (v === 'summary') exportFile(`dara-report-${stamp}.csv`, reportCsv(monthTitle(y, m), monthReport(store.assets, store.txs, rg.from, rg.to, store.history ?? [])));
      else exportFile(`dara-transactions-${stamp}.csv`, txCsv(store.assets, store.txs, rg.from, rg.to));
      break;
    }
    case 'income-new':
      modal = { kind: 'income', f: newIncomeForm() };
      renderModal();
      break;
    case 'income-kind':
      if (modal?.kind === 'income') { modal.f.kind = (v as IncomeKind) || 'dividend'; renderModal(); }
      break;
    case 'income-calc': {
      if (modal?.kind !== 'income') break;
      const f = modal.f;
      const pr = parseField('اصل پول', f.principal);
      if (typeof pr === 'string') return setErr(pr);
      const rate = Number(toEn(f.rate));
      if (!f.rate.trim() || !Number.isFinite(rate) || rate < 0) return setErr('نرخ سود سالانه معتبر نیست.');
      const from = jalaliToIso(Number(toEn(f.fy)), Number(toEn(f.fm)), Number(toEn(f.fd)));
      const to = jalaliToIso(Number(toEn(f.y)), Number(toEn(f.m)), Number(toEn(f.d)));
      if (!from || !to) return setErr('تاریخ شروع یا دریافت معتبر نیست.');
      const r = accrualInterest(toRialDec(pr), Decimal.of(String(rate)), from, to);
      if (!r) return setErr('تاریخ دریافت باید بعد از تاریخ شروع باشد.');
      f.amount = rialToField(r.toString());
      f.error = '';
      renderModal();
      break;
    }
    case 'income-save': {
      if (modal?.kind !== 'income') break;
      const f = modal.f;
      const date = jalaliToIso(Number(toEn(f.y)), Number(toEn(f.m)), Number(toEn(f.d)));
      if (!date) return setErr('تاریخ دریافت معتبر نیست.');
      const amt = parseField('مبلغ سود', f.amount);
      if (typeof amt === 'string') return setErr(amt);
      const rial = toRialDec(amt);
      const bad = validateIncome(date, rial);
      if (bad) return setErr(bad);
      const r = addTx(store.txs, incomeDraft(f.kind, date, rial, f.source));
      if (!r.ok) return setErr('ثبت سود انجام نشد.');
      store.txs = r.txs;
      save(); closeModal(); render();
      toast(`${INCOME_LABEL[f.kind]} ثبت شد و به نقد اضافه شد.`);
      break;
    }
    case 'infl-open':
      modal = { kind: 'infl', f: { v: typeof store.settings.inflation === 'number' ? String(store.settings.inflation) : '', error: '' } };
      renderModal();
      break;
    case 'infl-save': {
      if (modal?.kind !== 'infl') break;
      const n = Number(toEn(modal.f.v));
      if (!modal.f.v.trim() || !Number.isFinite(n) || n < 0 || n > 1000) return setErr('یک درصد معتبر بین ۰ تا ۱۰۰۰ وارد کنید.');
      store.settings.inflation = n;
      save(); closeModal(); render();
      break;
    }
    case 'infl-clear':
      delete store.settings.inflation;
      save(); closeModal(); render();
      break;
    case 'price-clear':
      if (modal?.kind === 'price') {
        delete store.prices[modal.f.assetId];
        save();
        closeModal();
        render();
      }
      break;
    case 'add-asset':
      modal = { kind: 'asset', f: newAssetForm() };
      renderModal();
      break;
    case 'asset-save': {
      if (modal?.kind !== 'asset') break;
      const f = modal.f;
      const name = f.name.trim();
      const unit = f.unit.trim();
      if (!name) return setErr('نام دارایی را وارد کنید.');
      if (!unit) return setErr('واحد اندازه‌گیری را وارد کنید.');
      if (store.assets.some((a) => a.name === name)) return setErr('دارایی با این نام وجود دارد.');
      const newAsset: Asset = {
        id: `a${Date.now().toString(36)}`, name, unit, kind: ASSET_PRESETS[f.preset]?.kind ?? 'custom', decimals: Number(f.decimals),
      };
      if (f.preset === 'stock_ir' && f.insCode.trim()) {
        if (!isInsCode(f.insCode.trim())) return setErr('کد نماد معتبر نیست (فقط رقم).');
        newAsset.priceKeys = { tsetmc: f.insCode.trim() };
      }
      store.assets.push(newAsset);
      save();
      if (pendingTx) {
        // برگشت به فرم معامله با دارایی تازه
        const back = pendingTx;
        pendingTx = null;
        back.assetId = newAsset.id;
        back.price = '';
        back.error = '';
        modal = { kind: 'tx', f: back };
        renderModal();
        toast('دارایی اضافه شد. مقدار و قیمت خرید را وارد کنید.');
        break;
      }
      closeModal();
      render();
      toast('دارایی اضافه شد. حالا می‌توانید خرید ثبت کنید.');
      break;
    }
    case 'set-type':
      if (modal?.kind === 'tx') {
        modal.f.type = v as TxType;
        renderModal();
      }
      break;
    case 'form-next':
      if (modal?.kind === 'tx') {
        const b = buildDraft(modal.f);
        if ('error' in b) return setErr(b.error);
        modal.f.error = '';
        modal.f.step = 'confirm';
        renderModal();
      }
      break;
    case 'form-back':
      if (modal?.kind === 'tx') {
        modal.f.step = 'form';
        renderModal();
      }
      break;
    case 'form-submit':
      if (modal?.kind === 'tx') {
        const sim = simulate(modal.f);
        if ('error' in sim || !sim.res.ok) {
          modal.f.step = 'form';
          renderModal();
          break;
        }
        const edit = modal.f.mode === 'edit';
        closeModal();
        commit(sim.res.txs);
        toast(edit ? 'تغییرات ثبت شد و محاسبات به‌روز شد.' : 'معامله ثبت شد.');
      }
      break;
    case 'toggle-hide':
      store.settings.hide = !store.settings.hide;
      save();
      render();
      break;
    case 'set-unit':
      store.settings.unit = v as Settings['unit'];
      save();
      render();
      break;
    case 'set-theme':
      store.settings.theme = v as Settings['theme'];
      save();
      render();
      break;
    case 'set-font':
      store.settings.font = v as Settings['font'];
      save();
      render();
      break;
    case 'add-from-market': {
      const e = mk().entries.find((x) => x.key === v);
      if (!e) break;
      const meta = classify(e.key);
      const perGram = /هر گرم/.test(meta.title);
      const name = meta.title.replace(/\s*\(هر گرم\)/, '').trim();
      const crypto = meta.category === 'crypto';
      const unit = perGram ? 'گرم' : crypto ? 'عدد' : meta.category === 'currency' ? 'واحد' : 'عدد';
      const decimals = perGram ? 3 : crypto ? 6 : meta.category === 'currency' ? 2 : 0;
      const asset: Asset = {
        id: `m_${e.key.replace(/[^a-z0-9]/gi, '_')}`, name, unit, kind: crypto ? 'crypto' : meta.category === 'currency' ? 'currency' : 'metal',
        decimals, priceKeys: { tgju: e.key },
      };
      if (store.assets.some((a) => a.id === asset.id)) break;
      store.assets.push(asset);
      save();
      closeModal();
      view.market = false;
      view.tab = 'assets';
      view.assetId = asset.id;
      render();
      toast('به دارایی‌ها اضافه شد. برای قیمت روز، «به‌روزرسانی قیمت‌ها» را بزنید یا قیمت را دستی وارد کنید.');
      break;
    }
    case 'stock-link': {
      const a = assetById(v);
      if (!a) break;
      const f = newAssetForm();
      f.linkId = a.id;
      f.q = a.name;
      f.insCode = a.priceKeys?.tsetmc ?? '';
      modal = { kind: 'asset', f };
      renderModal();
      if (!f.insCode) void runStockSearch(f);
      break;
    }
    case 'stock-link-save': {
      if (modal?.kind !== 'asset' || !modal.f.linkId) break;
      const a = assetById(modal.f.linkId);
      const code = modal.f.insCode.trim();
      if (!a) break;
      if (!isInsCode(code)) return setErr('نماد را جست‌وجو و انتخاب کنید یا کد نماد را وارد کنید (فقط رقم).');
      a.priceKeys = { ...(a.priceKeys ?? {}), tsetmc: code };
      save();
      closeModal();
      render();
      toast('به بورس وصل شد. «به‌روزرسانی قیمت‌ها» را بزنید.');
      break;
    }
    case 'stock-search':
      if (modal?.kind === 'asset') void runStockSearch(modal.f);
      break;
    case 'stock-pick': {
      if (modal?.kind !== 'asset') break;
      const h = modal.f.hits[Number(v)];
      if (!h) break;
      modal.f.name = h.symbol;
      modal.f.insCode = h.insCode;
      modal.f.hits = [];
      modal.f.error = '';
      void stockPreview(modal.f);
      break;
    }
    case 'stock-test':
      if (modal?.kind === 'asset') void stockPreview(modal.f);
      break;
    case 'recover-mirror':
      if (recoverMirror) {
        store = recoverMirror;
        recoverMirror = null;
        writesBlocked = false;
        modal = null;
        save();
        closeModal();
        render();
        toast('اطلاعات از نسخه‌ی خودکار گوشی بازیابی شد.');
      }
      break;
    case 'recover-file':
      (document.getElementById('restore-file') as HTMLInputElement | null)?.click();
      break;
    case 'recover-empty':
      writesBlocked = false;
      modal = null;
      save();
      closeModal();
      render();
      toast('با اطلاعات خالی شروع شد. کپی داده‌ی قبلی در گوشی نگه‌داری می‌شود.');
      break;
    case 'rem-open':
      openReminders();
      break;
    case 'rem-back':
      if (modal?.kind === 'rem') { modal.f = newRemForm('list'); renderModal(); }
      break;
    case 'rem-new-date':
      if (modal?.kind === 'rem') { modal.f = newRemForm('date'); renderModal(); }
      break;
    case 'rem-new-price':
      if (modal?.kind === 'rem') {
        if (!store.assets.some((a) => a.id !== CASH_ID)) { toast('اول یک دارایی یا سهم اضافه کنید.'); break; }
        modal.f = newRemForm('price');
        renderModal();
      }
      break;
    case 'rem-flead':
      if (modal?.kind === 'rem') { modal.f.lead = v; renderModal(); }
      break;
    case 'rem-side':
      if (modal?.kind === 'rem') { modal.f.side = v === 'buy' ? 'buy' : 'sell'; renderModal(); }
      break;
    case 'rem-cond':
      if (modal?.kind === 'rem') { modal.f.cond = v === 'below' ? 'below' : 'above'; renderModal(); }
      break;
    case 'rem-save-date':
      saveDateReminder();
      break;
    case 'rem-save-price':
      savePriceReminder();
      break;
    case 'rem-pay':
      closeModal();
      openPayForm(v, false);
      break;
    case 'rem-done': {
      const r = remList().find((x) => x.id === v);
      if (r && r.kind === 'date') { r.done = true; save(); renderModal(); render(); }
      break;
    }
    case 'rem-del':
      store.reminders = remList().filter((x) => x.id !== v);
      save();
      renderModal();
      render();
      break;
    case 'rem-rearm': {
      const r = remList().find((x) => x.id === v);
      if (r && r.kind === 'price') {
        const cur = store.prices[r.assetId];
        const curD = cur ? parseDec(cur.price) : null;
        if (curD && priceHit(r, curD)) { toast('قیمت فعلی هنوز به این هدف رسیده است؛ اول هدف را حذف و هدف تازه بگذارید.'); break; }
        delete r.firedAt;
        delete r.seen;
        save();
        renderModal();
        render();
      }
      break;
    }
    case 'rem-inst':
      store.settings.rem = { ...store.settings.rem, installments: v === '1' };
      save();
      renderModal();
      render();
      break;
    case 'rem-ilead':
      store.settings.rem = { ...store.settings.rem, installmentLead: Number(v) };
      save();
      renderModal();
      render();
      break;
    case 'rem-hour':
      store.settings.rem = { ...store.settings.rem, hour: Number(v) };
      save();
      renderModal();
      break;
    case 'rem-perm':
      toNative({ type: 'notify-perm', ask: true });
      break;
    case 'support-open':
      // داخل اپ، وب‌ویو نباید خودش به صفحه‌ی بیرونی برود؛ باز کردن را به اندروید می‌سپاریم
      if (inApp()) {
        ev.preventDefault();
        toNative({ type: 'open', url: SUPPORT_URL });
      }
      break;
    case 'support-copy':
      navigator.clipboard?.writeText(SUPPORT_ID).then(
        () => toast('شناسه کپی شد.'),
        () => toast('کپی ممکن نشد؛ دکمه‌ی «باز کردن تلگرام» را بزنید.'),
      ) ?? toast('کپی ممکن نشد؛ دکمه‌ی «باز کردن تلگرام» را بزنید.');
      break;
    case 'update-check':
      checkUpdate();
      break;
    case 'update-install':
      upd.status = 'downloading';
      upd.pct = 0;
      toNative({ type: 'update-install', url: upd.url });
      render();
      break;
    case 'check-new':
      modal = { kind:'check', f:newChequeForm(v==='issued'?'issued':'received') }; renderModal();
      break;
    case 'check-edit': {
      const c=(store.cheques ?? []).find(x=>x.id===v); if(c){modal={kind:'check',f:editChequeForm(c)};renderModal();} break;
    }
    case 'check-save': saveCheque(); break;
    case 'check-del': {
      const removed=(store.cheques ?? []).find(x=>x.id===v);
      if(removed?.cashTxId){ const r=deleteTx(store.txs,removed.cashTxId,new Date().toISOString()); if(!r.ok){ toast('حذف چک ممکن نشد.'); break; } store.txs=r.txs; if(r.issues.some(i=>i.code==='NEGATIVE_CASH')) toast('هشدار: با حذف این چک موجودی نقد منفی شد.'); }
      if(removed?.reminderId) store.reminders=remList().filter(r=>r.id!==removed.reminderId);
      store.cheques=(store.cheques ?? []).filter(x=>x.id!==v); save(); render(); toast('چک حذف شد.'); break;
    }
    case 'check-dir':
      if(modal?.kind==='check'){modal.f.direction=v==='issued'?'issued':'received';renderModal();}
      break;
    case 'open-person':
      view.person = v;
      render();
      window.scrollTo(0, 0);
      break;
    case 'new-debt':
      modal = { kind: 'debt', f: newDebtForm(v as Direction, el.dataset.person ?? '') };
      renderModal();
      break;
    case 'edit-debt': {
      const d = store.debts.find((x) => x.id === v);
      if (d) {
        modal = { kind: 'debt', f: editDebtForm(d) };
        renderModal();
      }
      break;
    }
    case 'debt-dir':
      if (modal?.kind === 'debt') {
        modal.f.direction = v as Direction;
        renderModal();
      }
      break;
    case 'debt-save':
      saveDebt();
      break;
    case 'new-pay':
      openPayForm(v, false);
      break;
    case 'settle':
      openPayForm(v, true);
      break;
    case 'edit-pay': {
      const p = store.payments.find((x) => x.id === v);
      if (p) {
        modal = { kind: 'pay', f: { mode: 'edit', id: p.id, debtId: p.debtId, ...jf(p.date), amount: rialToField(p.amount), fromCash: !!p.fromCash, note: p.note ?? '', error: '' } };
        renderModal();
      }
      break;
    }
    case 'pay-save':
      savePay();
      break;
    case 'del-pay':
      softDelete('payment', v);
      break;
    case 'del-debt':
      softDelete('debt', v);
      break;
    case 'del-person':
      softDelete('person', v);
      break;
    case 'ask':
      modal = { kind: 'ask', what: v as 'reset' | 'clear' };
      renderModal();
      break;
    case 'ask-yes':
      store = v === 'reset' ? { ...seed(), settings: store.settings, market: mk() } : emptyStore(store.settings, mk());
      view.assetId = null;
      save();
      closeModal();
      render();
      toast(v === 'reset' ? 'داده‌ی آزمایشی بارگذاری شد.' : 'همه‌ی داده‌ها پاک شد.');
      break;
    case 'start-empty':
      store = emptyStore(store.settings, mk());
      save();
      render();
      toast('با داده‌ی خالی شروع شد.');
      break;
    case 'refresh':
      void runRefresh();
      break;
    case 'paste-open':
      modal = { kind: 'paste', f: { text: '', error: '' } };
      renderModal();
      break;
    case 'paste-apply': {
      if (modal?.kind !== 'paste') break;
      let quotes;
      try {
        quotes = parseTgju(modal.f.text.trim());
      } catch (e) {
        return setErr(e instanceof Error ? e.message : 'متن معتبر نیست.');
      }
      const r = applyQuotes(store.assets, store.prices, quotes, { id: 'tgju', name: 'TGJU' }, { now: Date.now() });
      store.market = { source: 'pasted', entries: parseMarket(modal.f.text.trim()) };
      showPriceResults(r.prices, r.results, []);
      break;
    }
    case 'close':
      if (pendingTx && modal?.kind === 'asset') {
        modal = { kind: 'tx', f: pendingTx };
        pendingTx = null;
        renderModal();
      } else closeModal();
      break;
    default:
  }
});

const friendlyError = (m: string) =>
  /[\u0600-\u06FF]/.test(m) ? m : 'اتصال به سرور برقرار نشد (اینترنت قطع است یا مرورگر اجازه‌ی اتصال نمی‌دهد).';

function showPriceResults(
  prices: Record<string, PriceEntry>, results: PriceResult[], errors: { provider: string; message: string }[],
) {
  store.prices = prices;
  save();
  toastEl.innerHTML = '';
  render();
  checkPriceAlerts();
  modal = { kind: 'prices', results, errors: errors.map((e) => ({ provider: e.provider, message: friendlyError(e.message) })) };
  renderModal();
}

/* --- اتصال به اپ اندروید: وب‌ویو نمی‌تواند مستقیم به TGJU وصل شود، پس درخواست را به بخش بومی می‌دهد --- */
interface RNBridge { postMessage(msg: string): void }
type Pending = { resolve: (r: { ok: boolean; status: number; text(): Promise<string> }) => void; reject: (e: Error) => void };
const pendingFetch = new Map<string, Pending>();

function nativeFetch(url: string) {
  const rn = (window as unknown as { ReactNativeWebView?: RNBridge }).ReactNativeWebView;
  if (!rn) {
    // نسخه‌ی وب روی GitHub Pages: مرورگر اجازه‌ی خواندن مستقیم TGJU را نمی‌دهد؛ یک نسخه‌ی خودکارِ کنار صفحه خوانده می‌شود
    if (url === TGJU_URL && /\.github\.io$/.test(location.hostname)) return fetch('prices/tgju.json?t=' + Date.now(), { cache: 'no-store' });
    return fetch(url);
  }
  return new Promise<{ ok: boolean; status: number; text(): Promise<string> }>((resolve, reject) => {
    const id = nid('f');
    pendingFetch.set(id, { resolve, reject });
    rn.postMessage(JSON.stringify({ type: 'fetch', id, url }));
    window.setTimeout(() => {
      if (pendingFetch.delete(id)) reject(new Error('پاسخی از دستگاه نرسید. اینترنت را بررسی کنید.'));
    }, 25000);
  });
}

const bridgeWindow = window as unknown as {
  __bridgeReply?: (id: string, ok: boolean, status: number, body: string, err: string) => void;
  __hwBack?: () => void;
};
bridgeWindow.__bridgeReply = (id, ok, status, body, err) => {
  const p = pendingFetch.get(id);
  if (!p) return;
  pendingFetch.delete(id);
  if (err) p.reject(new Error(err));
  else p.resolve({ ok, status, text: async () => body });
};
/** دکمه‌ی برگشت اندروید: اول پنجره/صفحه‌ی باز را می‌بندد؛ اگر چیزی نبود از برنامه خارج می‌شود */
bridgeWindow.__hwBack = () => {
  const rn = (window as unknown as { ReactNativeWebView?: RNBridge }).ReactNativeWebView;
  if (modal) closeModal();
  else if (view.person || view.assetId || view.market) {
    if (view.person && view.tab === 'people') view.person = null;
    else if (view.assetId) view.assetId = null;
    else view.market = false;
    render();
  } else if (view.tab !== 'home') {
    view.tab = 'home';
    render();
  } else rn?.postMessage(JSON.stringify({ type: 'exit' }));
};

/* --- به‌روزرسانی درون‌برنامه‌ای (فقط داخل اپ اندروید) --- */
interface UpdateState {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'installing' | 'error';
  current: number; latest: number; url: string; size: number; notes: string; pct: number; error: string;
}
const upd: UpdateState = { status: 'idle', current: 0, latest: 0, url: '', size: 0, notes: '', pct: 0, error: '' };
const inApp = () => !!(window as unknown as { ReactNativeWebView?: RNBridge }).ReactNativeWebView;
function toNative(msg: object) {
  (window as unknown as { ReactNativeWebView?: RNBridge }).ReactNativeWebView?.postMessage(JSON.stringify(msg));
}
function checkUpdate() {
  if (!inApp()) return;
  upd.status = 'checking';
  upd.error = '';
  toNative({ type: 'update-check' });
  if (view.tab === 'settings') render();
}
Object.assign(window, {
  __encAck: (_id: number, ok: boolean) => {
    // متن ساده فقط بعد از تأیید ذخیره‌ی نسخه‌ی رمزشده پاک می‌شود
    if (!ok || !plainPending) return;
    plainPending = false;
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    if (view.tab === 'settings') render();
  },
  __notifyPerm: (r: { ok: boolean }) => {
    remPerm = r.ok ? 'granted' : 'denied';
    if (modal?.kind === 'rem' && modal.f.view === 'list') renderModal();
  },
  __bioAvail: (r: { ok: boolean }) => {
    lk.bioAvail = !!r.ok;
    if (lk.locked && store.settings.lock?.bio && lk.bioAvail) toNative({ type: 'bio-auth', purpose: 'unlock' });
    if (view.tab === 'settings') render();
  },
  __bioReply: (r: { ok: boolean; purpose?: string }) => {
    if (!r.ok) return;
    if (r.purpose === 'enable' && store.settings.lock) {
      store.settings.lock.bio = true;
      save();
      render();
      toast('اثر انگشت روشن شد.');
    } else if (r.purpose === 'unlock' && lk.locked) {
      unlockNow();
    }
  },
  __appState: (st: string) => appVisibility(st === 'active' ? 'active' : 'background'),
  __shareReply: (r: { ok: boolean; error?: string }) => {
    if (!r.ok) toast('ارسال فایل ممکن نشد: ' + (r.error ?? 'خطای نامشخص'));
  },
  __updateReply: (r: { ok: boolean; current: number; latest: number; url: string; size: number; notes: string; error: string }) => {
    upd.current = r.current;
    if (!r.ok) {
      upd.status = 'error';
      upd.error = r.error;
    } else if (r.latest > r.current && r.url) {
      Object.assign(upd, { status: 'available', latest: r.latest, url: r.url, size: r.size, notes: r.notes });
    } else upd.status = 'none';
    if (r.ok) upd.latest = r.latest;
    try { localStorage.setItem('hooman-finance-lastcheck', String(Date.now())); } catch { /* ignore */ }
    if (!modal) render();
  },
  __updateProgress: (pct: number) => {
    upd.status = 'downloading';
    upd.pct = pct;
    const el = document.getElementById('upd-pct');
    if (el) el.textContent = toFa(String(pct)) + '٪';
    else if (!modal) render();
  },
  __updateState: (status: UpdateState['status'], error: string) => {
    upd.status = status;
    upd.error = error;
    if (!modal) render();
  },
});
/** بررسی خودکار حداکثر روزی یک بار، هنگام باز شدن برنامه */
function autoCheckUpdate() {
  if (!inApp()) return;
  let last = 0;
  try { last = Number(localStorage.getItem('hooman-finance-lastcheck') ?? '0'); } catch { /* ignore */ }
  if (Date.now() - last > 24 * 3600e3) window.setTimeout(checkUpdate, 1500);
}

let refreshing = false;
async function runRefresh(silent = false) {
  if (refreshing) return;
  refreshing = true;
  if (!silent) toast('در حال دریافت قیمت‌ها…');
  try {
    const providers = [tgjuProvider((u) => nativeFetch(u), undefined, undefined, (raw) => {
      store.market = { source: 'tgju', entries: parseMarket(raw) };
    })];
    const stockCodes = store.assets.map((a) => a.priceKeys?.tsetmc).filter((c): c is string => !!c);
    if (stockCodes.length) providers.push(tsetmcProvider((u) => tsetmcFetch(u), stockCodes));
    const out = await refreshPrices(store.assets, store.prices, providers, { now: Date.now() });
    if (silent) {
      // به‌روزرسانی خودکار هنگام باز شدن: بدون پنجره‌ی نتیجه؛ فقط اگر هیچ قیمتی نیامد خبر می‌دهیم
      store.prices = out.prices;
      save();
      if (!modal) render();
      checkPriceAlerts();
      const any = out.results.some((r) => r.status === 'updated' || r.status === 'unchanged');
      if (!any && out.errors.length) toast('به‌روزرسانی خودکار قیمت‌ها انجام نشد: ' + friendlyError(out.errors[0].message));
    } else {
      showPriceResults(out.prices, out.results, out.errors);
    }
  } catch (e) {
    if (!silent) throw e;
  } finally {
    refreshing = false;
  }
}

function setErr(msg: string) {
  if (modal && modal.kind !== 'recover' && modal.kind !== 'ask' && modal.kind !== 'prices' && modal.kind !== 'quote') (modal.f as { error: string }).error = msg;
  const el = document.getElementById('ferr');
  if (el) el.textContent = msg;
}

document.addEventListener('input', (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t.id === 'search') {
    view.search = t.value;
    const list = document.getElementById('txlist');
    if (list) list.innerHTML = txListHtml();
    return;
  }
  if (t.id === 'msearch') {
    view.mq = t.value;
    const body = marketBody();
    const list = document.getElementById('mlist');
    const cnt = document.getElementById('mcount');
    if (list) list.innerHTML = body.html;
    if (cnt) cnt.textContent = body.count;
    return;
  }
  const field = t.dataset?.field;
  if (!field || !modal || modal.kind === 'recover' || modal.kind === 'ask' || modal.kind === 'prices' || modal.kind === 'quote') return;
  if (t.type === 'checkbox') {
    (modal.f as unknown as Record<string, boolean>)[field] = t.checked;
    if (field === 'plan' || modal.kind === 'family') renderModal();
    return;
  }
  (modal.f as unknown as Record<string, string>)[field] = t.value;
  if (modal.kind === 'tx') {
    const live = document.getElementById('live');
    if (live) live.innerHTML = liveTotal(modal.f);
  }
});

document.addEventListener('change', (ev) => {
  const inp = ev.target as HTMLInputElement;
  if (inp.id === 'restore-file' && inp.files?.[0]) {
    const file = inp.files[0];
    if (file.size > 20 * 1024 * 1024) { toast('این فایل برای پشتیبان بسیار بزرگ است.'); inp.value = ''; return; }
    void file.text().then((text) => {
      modal = { kind: 'restore', f: { text, pass: '', error: '', busy: false, stage: 'pass', parsed: null, at: '' } };
      renderModal();
      inp.value = '';
    }, () => toast('خواندن فایل ممکن نشد.'));
    return;
  }
  const t = ev.target as HTMLSelectElement;
  if (t.dataset?.field === 'assetId' && modal?.kind === 'rem') {
    modal.f.assetId = t.value;
    renderModal();
    return;
  }
  if (modal?.kind === 'check' && t.dataset?.field) { (modal.f as unknown as Record<string,string>)[t.dataset.field]=t.value; return; }
  if (t.dataset?.field === 'assetId' && modal?.kind === 'tx' && t.value === '__new') {
    pendingTx = modal.f;
    modal = { kind: 'asset', f: newAssetForm() };
    renderModal();
    return;
  }
  if (t.dataset?.field === 'preset' && modal?.kind === 'asset') {
    const pr = ASSET_PRESETS[t.value];
    if (pr) Object.assign(modal.f, { preset: t.value, unit: pr.unit, decimals: pr.decimals });
    renderModal();
    return;
  }
  if (t.dataset?.field === 'assetId' && modal?.kind === 'tx') {
    modal.f.assetId = t.value;
    const cash = t.value === CASH_ID;
    if (!optionsFor(cash).includes(modal.f.type)) modal.f.type = optionsFor(cash)[0];
    modal.f.price = suggestPrice(t.value);
    modal.f.fee = '';
    renderModal();
  }
});

let sparkDown = false;
document.addEventListener('pointerdown', (ev) => {
  const svg = (ev.target as Element | null)?.closest?.('.spark-svg') as SVGSVGElement | null;
  if (!svg) return;
  sparkDown = true;
  sparkSelect(svg, ev.clientX);
});
document.addEventListener('pointermove', (ev) => {
  if (!sparkDown) return;
  const svg = document.querySelector('.spark-svg') as SVGSVGElement | null;
  if (svg) sparkSelect(svg, ev.clientX);
});
document.addEventListener('pointerup', () => { sparkDown = false; });
document.addEventListener('pointercancel', () => { sparkDown = false; });

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && modal) closeModal();
});

/** باز کردن اطلاعات رمزشده؛ اگر نشد، نوشتن مسدود می‌ماند و پنجره‌ی بازیابی نشان داده می‌شود */
async function bootSecure() {
  try {
    secureKey = await importKey(keyHex!);
    if (pendingEnvelope) {
      const s = parseStore(await decryptText(secureKey, pendingEnvelope));
      if (!s) throw new Error('bad');
      store = s;
      recoverMirror = null;
      writesBlocked = false;
      pendingEnvelope = null;
    }
  } catch {
    secureKey = null;
    if (!pendingEnvelope) secureMode = false; // کلید ساخته نشد: مثل قبل بدون رمزنگاری
  }
}

function startup() {
  lk.locked = !!store.settings.lock;
  if (secureMode && !writesBlocked && !store.sample) {
    try { plainPending = !!localStorage.getItem(KEY); } catch { /* ignore */ }
  }
  if (!writesBlocked) recordHistory();
  if (!store.sample) {
    if (secureMode) queueSecureSave(true);
    else persist();
  }
  render();
  // First-run migration / recovery mirror: keep the old localStorage copy untouched.
  if (!writesBlocked && !secureMode) toNative({ type: 'sqlite-snapshot', snapshot: JSON.stringify(store) });
  if (writesBlocked) { modal = { kind: 'recover' }; renderModal(); }
  else if (!store.settings.onboarded && !store.sample && store.txs.length === 0 && !(store.debts?.length) && !(store.cheques?.length)) {
    modal = { kind: 'onboard', f: { step: 0 } }; renderModal();
  } else if (!store.settings.onboarded && !store.sample) {
    store.settings.onboarded = true; // کاربر قدیمی با داده: راهنما لازم نیست
    persist();
  }
  if (!writesBlocked && recoveredFromMirror) window.setTimeout(() => toast('اطلاعات از نسخه‌ی پشتیبان خودکار گوشی بازیابی شد.'), 300);
  autoCheckUpdate();
  checkPriceAlerts();
  scheduleNoteSync();
  widgetSync();
  renderLock();
}

document.addEventListener('keydown', (ev) => {
  if (!lk.locked || lk.forgot) return;
  if (/^[0-9۰-۹]$/.test(ev.key)) lkDigit(normalizePin(ev.key));
  else if (ev.key === 'Backspace') { lk.entry = lk.entry.slice(0, -1); renderLock(); }
});
document.addEventListener('visibilitychange', () => appVisibility(document.visibilityState === 'visible' ? 'active' : 'background'));
toNative({ type: 'bio-check' });

/** قیمت‌ها هنگام باز شدن اپ و بازگشت به آن خودکار به‌روز می‌شوند (حداکثر هر ۵ دقیقه) */
let lastAutoRefresh = 0;
function autoRefresh() {
  if (!inApp() || Date.now() - lastAutoRefresh < 5 * 60_000) return;
  lastAutoRefresh = Date.now();
  void runRefresh(true);
}
window.setTimeout(autoRefresh, 800);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoRefresh(); });
window.addEventListener('focus', autoRefresh);

if (secureMode) void bootSecure().then(startup);
else startup();

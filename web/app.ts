import { Decimal } from '../src/core/decimal';
import {
  addTx, computeAssetState, computeCash, computePortfolio, deleteTx, restoreTx, updateTx,
  ChangeResult, Portfolio, TxDraft, parseDec,
} from '../src/core/engine';
import { Asset, CASH_ID, PriceEntry, Tx, TxType } from '../src/core/types';
import { assetIcon, iconKind, iconSvg } from './icons';
import { InstrumentHit, isInsCode, parseClosingInfo, parseSearch, quoteUrl, searchUrl, tsetmcProvider } from '../src/core/tsetmc';
import { DEFAULT_PRICE_KEYS, PriceResult, applyQuotes, parseTgju, refreshPrices, tgjuProvider } from '../src/core/prices';
import {
  CATEGORIES, CategoryId, MarketEntry, classify, isStale, parseMarket, searchMarket, snapshotTime,
} from '../src/core/market';
import sampleRaw from './market-sample.json';
import { formatJalali, isoToJalali, jalaliToIso, todayIso } from '../src/core/jalali';
import {
  Debt, DebtPayment, DebtState, Direction, PeopleData, Person, addJalaliMonths, cashEffect, computeDebt,
  computePeople, netWorth, validatePeople,
} from '../src/core/people';

/* ============================== وضعیت ============================== */

type Tab = 'home' | 'assets' | 'txs' | 'people' | 'settings';
interface Settings {
  /** پنهان کردن مبلغ‌ها (برای وقتی دیگران نگاه می‌کنند) */
  hide?: boolean;
  unit: 'toman' | 'rial';
  theme: 'system' | 'light' | 'dark';
  font: 'normal' | 'large';
}
interface MarketSnapshot {
  source: 'sample' | 'tgju' | 'pasted';
  entries: MarketEntry[];
}
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
    people: [{ id: 'p1', name: 'هومن' }, { id: 'p2', name: 'بلو بانک' }],
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
  return { v: 1, sample: false, market: market ?? bundledMarket(), assets: DEFAULT_ASSETS.map((a) => ({ ...a })), txs: [], prices: {}, people: [], debts: [], payments: [], settings };
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (s && s.v === 1 && Array.isArray(s.assets) && Array.isArray(s.txs) && s.settings) {
        if (!s.market || !Array.isArray(s.market.entries)) s.market = bundledMarket();
        if (!Array.isArray(s.people)) s.people = [];
        if (!Array.isArray(s.debts)) s.debts = [];
        if (!Array.isArray(s.payments)) s.payments = [];
        return s;
      }
    }
  } catch {
    /* ذخیره‌سازی در دسترس نیست؛ با داده‌ی آزمایشی ادامه می‌دهیم */
  }
  return seed();
}

let store: Store = load();
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* بدون ذخیره‌سازی هم برنامه کار می‌کند ولی داده پس از بستن می‌ماند */
  }
}

/* ============================ قالب‌بندی ============================ */

const FA = '۰۱۲۳۴۵۶۷۸۹';
const toFa = (s: string) => s.replace(/\d/g, (d) => FA[Number(d)]);
const toEn = (s: string) =>
  s
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[٬,،\s‌‏‎]/g, '')
    .replace(/٫/g, '.');
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const group = (i: string) => i.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');

function fmtNum(d: Decimal, places = 0): string {
  const s = d.toFixed(places);
  const neg = s[0] === '-';
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
  const fr = f.replace(/0+$/, '');
  return (neg ? '−' : '') + toFa(group(i)) + (fr ? '٫' + toFa(fr) : '');
}

const isToman = () => store.settings.unit === 'toman';
const unitLabel = () => (isToman() ? 'تومان' : 'ریال');
const fromRial = (r: Decimal) => (isToman() ? r.div(10) : r);
const toRialDec = (v: Decimal) => (isToman() ? v.mul(10) : v);

const ltr = (s: string) => `<bdi dir="ltr" class="num">${s}</bdi>`;
const MASK = '<span class="num">••••••</span>';
const hidden = () => !!store.settings.hide;
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
};

const assetById = (id: string) => store.assets.find((a) => a.id === id);
const assetName = (id: string) => (id === CASH_ID ? 'وجه نقد' : assetById(id)?.name ?? id);
const TYPE_LABEL: Record<TxType, string> = { buy: 'خرید', sell: 'فروش', receive: 'دریافت (هدیه)', deposit: 'واریز (حقوق، هدیه)', withdraw: 'برداشت' };

const ICONS: Record<Tab, string> = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  assets: '<circle cx="9" cy="12" r="6"/><path d="M15 6.3A6 6 0 1 1 15 17.7"/>',
  txs: '<path d="M7 4v16M7 20l-3-3M7 20l3-3"/><path d="M17 20V4M17 4l-3 3M17 4l3 3"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.4 2.7-5.5 6-5.5s6 2.1 6 5.5"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.8c1.8.7 3 2.3 3 5.2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
};
const TAB_LABEL: Record<Tab, string> = {
  home: 'خانه', assets: 'دارایی‌ها', txs: 'معاملات', people: 'اشخاص', settings: 'تنظیمات',
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

function header(title: string, sub = ''): string {
  return `<header class="top"><h1>${title}</h1><span class="date">${sub || 'امروز ' + dateFa(todayIso())}</span></header>`;
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

interface Slice { key: string; label: string; value: Decimal; color: string }

/** نمودار سهم هر بخش از کل سرمایه‌ی مثبت (نقد، دارایی‌ها، طلب‌ها). بدهی‌ها جدا نوشته می‌شود. */
function allocationSection(pf: Portfolio, ppl: { receivable: Decimal; payable: Decimal }): string {
  const raw: { key: string; label: string; value: Decimal }[] = [];
  if (pf.cash.gt(0)) raw.push({ key: 'cash', label: 'وجه نقد', value: pf.cash });
  for (const a of pf.assets) if (a.value && a.value.gt(0)) raw.push({ key: a.asset.id, label: a.asset.name, value: a.value });
  if (ppl.receivable.gt(0)) raw.push({ key: 'recv', label: 'طلب از اشخاص', value: ppl.receivable });
  const total = raw.reduce((t, x) => t.plus(x.value), Decimal.ZERO);
  if (raw.length === 0 || total.lte(0)) return '';
  // حداکثر ۸ رنگ؛ بقیه در «سایر» جمع می‌شوند (بزرگ‌ترین‌ها جدا می‌مانند)
  const sorted = [...raw].sort((a, b) => b.value.cmp(a.value));
  const keep = sorted.length > 8 ? sorted.slice(0, 7) : sorted;
  const rest = sorted.length > 8 ? sorted.slice(7) : [];
  const slices: Slice[] = keep.map((x) => ({ ...x, color: '' }));
  if (rest.length) {
    slices.push({ key: 'other', label: `سایر (${toFa(String(rest.length))} مورد)`, value: rest.reduce((t, x) => t.plus(x.value), Decimal.ZERO), color: '' });
  }
  // رنگ بر اساس هویت (ترتیب ثابت ثبت)، نه رتبه: با تغییر قیمت‌ها رنگ هر دارایی عوض نمی‌شود
  const order = raw.map((x) => x.key);
  slices.forEach((sl) => {
    sl.color = sl.key === 'other' ? 'var(--c-other)' : `var(--c${(order.indexOf(sl.key) % 8) + 1})`;
  });
  const fracs = slices.map((sl) => sl.value.div(total).toNumber() * 100);
  const iconFor = (sl: Slice): string => {
    if (sl.key === 'cash') return `<span class="ico sm">${iconSvg({ t: 'cash' })}</span>`;
    if (sl.key === 'recv') return `<span class="ico sm">${iconSvg({ t: 'people' })}</span>`;
    const asset = store.assets.find((x) => x.id === sl.key);
    return asset ? `<span class="ico sm">${iconSvg(iconKind(asset))}</span>` : '';
  };
  const list = slices
    .map(
      (sl, i) => `<div class="ab">
        <div class="ah"><span class="nm">${iconFor(sl)}<span class="tx">${esc(sl.label)}</span></span><span class="pc">${pctText(fracs[i])}</span></div>
        <div class="track" role="img" aria-label="${esc(sl.label)}: ${pctText(fracs[i])}"><i style="width:${Math.max(fracs[i], 1).toFixed(2)}%;background:${sl.color}"></i></div>
        <div class="am">${money(sl.value)}</div></div>`,
    )
    .join('');
  const debtNote = ppl.payable.gt(0)
    ? `<div class="hint">بدهی‌های شما (${money(ppl.payable)}) در این نمودار نیست؛ معادل ${pctText(ppl.payable.div(total).toNumber() * 100)} از جمع بالاست.</div>`
    : '';
  const missing = pf.missingPrice.length
    ? `<div class="hint">برای ${toFa(String(pf.missingPrice.length))} دارایی قیمت روز ثبت نشده و در نمودار نیامده است.</div>`
    : '';
  return `<h2 class="section-title"><span>سهم هر دارایی از سرمایه</span></h2>
    <section class="alloc" aria-label="سهم هر دارایی از سرمایه">${list}</section>${debtNote}${missing}`;
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
      <span class="hint">${f.preview ? esc(f.preview) : 'با «قیمت آزمایشی» آخرین قیمت را ببینید و با سایت بورس مقایسه کنید.'}</span></div>`;
}

/** قیمت آزمایشی نماد برای تطبیق با سایت بورس؛ هیچ قیمتی ذخیره نمی‌شود */
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
    const res = await nativeFetch(quoteUrl(f.insCode));
    if (!res.ok) throw new Error(`پاسخ نامعتبر از سرور (${res.status}).`);
    const q = parseClosingInfo(await res.text(), f.insCode);
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
    const res = await nativeFetch(searchUrl(f.q));
    if (!res.ok) throw new Error(`پاسخ نامعتبر از سرور (${res.status}).`);
    f.hits = parseSearch(await res.text()).slice(0, 8);
    if (f.hits.length === 0) f.error = 'نمادی با این نام پیدا نشد.';
  } catch (e) {
    f.error = e instanceof Error ? e.message : 'جست‌وجو انجام نشد.';
  }
  f.busy = false;
  if (modal?.kind === 'asset' && modal.f === f) renderModal();
}

function viewHome(pf: Portfolio): string {
  const assetsValue = pf.assets.reduce((s, a) => (a.value ? s.plus(a.value) : s), Decimal.ZERO);
  const total = pf.totalValue;
  const ppl = computePeople(peopleData(), todayIso());
  const worth = netWorth(pf.cash, assetsValue, ppl);
  const missing = pf.missingPrice.map((id) => esc(assetName(id)));

  const rows: string[] = [];
  const pct = (v: Decimal) =>
    total.gt(0) ? Math.max(0, Math.min(100, v.div(total).toNumber() * 100)).toFixed(1) : '0';
  rows.push(`<div class="row"><div class="main"><span class="t">وجه نقد</span>
      <div class="bar" aria-hidden="true"><i style="width:${pct(pf.cash)}%"></i></div></div>
      <div class="side"><span class="t">${money(pf.cash)}</span></div></div>`);
  for (const a of pf.assets) {
    if (a.state.quantity.isZero() && a.state.rows.length === 0) continue;
    const side = a.value
      ? `<span class="t">${money(a.value)}</span><span class="s">${pnl(a.unrealized)}</span>`
      : `<span class="s">قیمت روز ثبت نشده</span>`;
    rows.push(`<button class="row" data-action="open-asset" data-v="${esc(a.asset.id)}">
      ${assetIcon(a.asset)}<div class="main"><span class="t">${esc(a.asset.name)}</span>
      <span class="s">${qty(a.state.quantity, a.asset)}</span>
      <div class="bar" aria-hidden="true"><i style="width:${a.value ? pct(a.value) : '0'}%"></i></div></div>
      <div class="side">${side}</div></button>`);
  }

  return `${header('Hooman Finance')}
    ${sampleNote()}
    <section class="hero" aria-label="خلاصه‌ی دارایی">
      <div class="between"><span class="label">سرمایه‌ی خالص</span>
        <button class="eye" data-action="toggle-hide" aria-pressed="${hidden()}" aria-label="${hidden() ? 'نمایش مبلغ‌ها' : 'پنهان کردن مبلغ‌ها'}">${hidden() ? EYE_OFF : EYE_ON}</button></div>
      <div class="big">${hidden() ? MASK : ltr(fmtNum(fromRial(worth)))}<span class="u">${unitLabel()}</span></div>
      <div class="split"><span>نقد: <b>${money(pf.cash, false)}</b></span><span>دارایی‌ها: <b>${money(assetsValue, false)}</b></span></div>
      <div class="split"><span>طلب‌ها: <b>${money(ppl.receivable, false)}</b></span><span>بدهی‌ها: <b>${money(ppl.payable, false)}</b></span></div>
      <div class="formula">سرمایه‌ی خالص = نقد + (مقدار هر دارایی × قیمت روز) + طلب‌ها − بدهی‌ها</div>
    </section>
    ${
      missing.length
        ? `<div class="note"><span>قیمت روز ${missing.join('، ')} ثبت نشده است، پس مجموع بالا ناقص است.</span>
           <button class="btn link" data-action="price" data-v="${esc(pf.missingPrice[0])}">ثبت قیمت روز</button></div>`
        : ''
    }
    ${allocationSection(pf, ppl)}
    <div class="grid2">
      <div class="tile"><span class="k">سود یا زیان فروش‌ها (تحقق‌یافته)</span><span class="v">${pnl(pf.realizedTotal)}</span></div>
      <div class="tile"><span class="k">سود یا زیان دارایی‌های فعلی</span><span class="v">${pnl(pf.unrealizedTotal)}</span></div>
    </div>
    <div class="actions">
      <button class="btn" data-action="new-tx" data-asset="" data-type="buy">ثبت خرید</button>
      <button class="btn" data-action="new-tx" data-asset="" data-type="sell">ثبت فروش</button>
      <button class="btn ghost" data-action="new-tx" data-asset="${CASH_ID}" data-type="deposit">واریز نقد</button>
    </div>
    <h2 class="section-title"><span>دارایی‌ها</span><button class="btn small ghost" data-action="refresh">به‌روزرسانی قیمت‌ها</button></h2>
    <div class="list">${rows.join('')}</div>
    ${
      inApp() && upd.status === 'available'
        ? '<div class="note info"><span>نسخه‌ی جدید برنامه آماده است.</span><button class="btn" data-action="update-install">دانلود و نصب</button></div>'
        : ''
    }
    ${marketSection()}`;
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
  if (meta.unit === 'irr') return money(d);
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

function quoteRow(e: MarketEntry, now: number): string {
  const meta = classify(e.key);
  const stale = isStale(e, now);
  const keyHint = meta.named ? `<bdi dir="ltr">${esc(e.key)}</bdi> · ` : '';
  return `<button class="row${stale ? ' dim' : ''}" data-action="quote" data-v="${esc(e.key)}">
    <div class="main"><span class="t">${esc(meta.title)}${stale ? ' <span class="badge">قدیمی</span>' : ''}</span>
      <span class="s">${keyHint}${entryTime(e)}${meta.per ? ' · ' + esc(meta.per) : ''}</span></div>
    <div class="side"><span class="t">${fmtVal(meta, e.price)}</span><span class="s">${changeHtml(e)}</span></div></button>`;
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
  const rows = PREVIEW_KEYS.map((k) => by.get(k))
    .filter((e): e is MarketEntry => !!e)
    .map((e) => quoteRow(e, now))
    .join('');
  return `<h2 class="section-title"><span>نمای بازار</span><button class="btn small ghost" data-action="market-open">همه‌ی قیمت‌ها</button></h2>
    ${marketNote()}
    <div class="list">${rows || '<div class="empty">قیمتی برای نمایش نیست.</div>'}</div>`;
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
    <div class="muted" id="mcount">${body.count}</div>
    <div class="list" id="mlist">${body.html}</div>
    <div class="note info"><span>نام و واحد فقط برای مواردی نوشته شده که از کلید و بزرگی عدد مطمئن‌ایم. بقیه با کلید اصلی و بدون واحد نمایش داده می‌شوند. قیمت‌هایی که از تازه‌ترین قیمت فهرست بیش از ۶ ساعت (یا ۴ روز برای قیمت‌های روزانه) عقب‌ترند پنهان‌اند.</span></div>`;
}

/* ------------------------------ دارایی‌ها ------------------------------ */

function viewAssets(pf: Portfolio): string {
  const rows = pf.assets
    .map((a) => {
      const side = a.value
        ? `<span class="t">${money(a.value)}</span>`
        : a.state.quantity.isZero()
          ? `<span class="s">موجودی صفر</span>`
          : `<span class="s">بدون قیمت روز</span>`;
      return `<button class="row" data-action="open-asset" data-v="${esc(a.asset.id)}">
        ${assetIcon(a.asset)}<div class="main"><span class="t">${esc(a.asset.name)}</span><span class="s">${qty(a.state.quantity, a.asset)}</span></div>
        <div class="side">${side}</div></button>`;
    })
    .join('');
  return `${header('دارایی‌ها')}
    <div class="list">
      <div class="row">${assetIcon({ id: CASH_ID, name: 'وجه نقد' })}<div class="main"><span class="t">وجه نقد</span><span class="s">جدا از دارایی‌ها؛ با واریز و برداشت تغییر می‌کند</span></div>
        <div class="side"><span class="t">${money(pf.cash)}</span></div></div>
      ${rows}
    </div>
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
    ? `<span class="v">${money(parseDec(price.price) as Decimal)}</span>
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
    </div>
    <div class="grid2">
      <div class="tile"><span class="k">میانگین قیمت خرید</span><span class="v">${money(state.avgCost)}</span></div>
      <div class="tile"><span class="k">بهای تمام‌شده‌ی موجودی</span><span class="v">${money(state.costBasis)}</span></div>
      <div class="tile"><span class="k">مجموع مبلغ خرید</span><span class="v">${money(state.totalBought)}</span></div>
      <div class="tile"><span class="k">مجموع کارمزدها</span><span class="v">${money(state.totalFees)}</span></div>
      <div class="tile"><span class="k">قیمت روز</span>${priceTile}</div>
      <div class="tile"><span class="k">سود یا زیان موجودی فعلی</span><span class="v">${pnl(unrealized)}</span></div>
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
        ? `${TYPE_LABEL[t.type]} نقد`
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
const nid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function netLabel(net: Decimal): string {
  if (net.isZero()) return '<span class="muted">تسویه‌شده</span>';
  return net.gt(0)
    ? `<span class="gain">او به شما بدهکار است: ${money(net)}</span>`
    : `<span class="loss">شما به او بدهکارید: ${money(net.neg())}</span>`;
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
  return `${header('اشخاص و حساب‌ها')}
    <div class="grid2">
      <div class="tile"><span class="k">جمع طلب‌های شما</span><span class="v gain">${money(sum.receivable)}</span></div>
      <div class="tile"><span class="k">جمع بدهی‌های شما</span><span class="v loss">${money(sum.payable)}</span></div>
    </div>
    <div class="actions">
      <button class="btn" data-action="new-debt" data-v="lent">به کسی پول دادم</button>
      <button class="btn" data-action="new-debt" data-v="borrowed">وام یا قرض گرفتم</button>
    </div>
    <div class="list">${rows || '<div class="empty">هنوز شخصی یا وامی ثبت نشده است.<br>مثلاً «به هومن ۱۰ میلیون قرض دادم» یا «وام بانک ۱۵ میلیون گرفتم».</div>'}</div>
    <div class="note info"><span>طلب‌ها و بدهی‌ها در «سرمایه‌ی خالص» صفحه‌ی خانه حساب می‌شوند: نقد + دارایی‌ها + طلب‌ها − بدهی‌ها.</span></div>`;
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
      <input id="d-name" data-field="name" list="d-names" value="${esc(f.name)}" autocomplete="off" placeholder="مثلاً هومن یا بلو بانک">
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

function updateSection(): string {
  if (!inApp()) return '';
  const mb = (b: number) => (b ? ` (${toFa((b / 1048576).toFixed(0))} مگابایت)` : '');
  let body: string;
  switch (upd.status) {
    case 'checking': body = '<span>در حال بررسی…</span>'; break;
    case 'none': body = '<span>برنامه‌ی شما به‌روز است.</span><button class="btn link" data-action="update-check">بررسی دوباره</button>'; break;
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
    <div class="note info">${body}</div>`;
}

function viewSettings(): string {
  const s = store.settings;
  return `${header('تنظیمات')}
    <div class="field"><span class="lab">واحد پول نمایش</span>${seg('set-unit', s.unit, [['toman', 'تومان'], ['rial', 'ریال']])}
      <span class="hint">همه‌ی مبالغ به‌صورت ریال ذخیره می‌شوند و فقط نمایش عوض می‌شود.</span></div>
    <div class="field"><span class="lab">ظاهر برنامه</span>${seg('set-theme', s.theme, [['system', 'خودکار'], ['light', 'روشن'], ['dark', 'تاریک']])}</div>
    <div class="field"><span class="lab">اندازه‌ی نوشته‌ها</span>${seg('set-font', s.font, [['normal', 'معمولی'], ['large', 'بزرگ']])}</div>
    <h2 class="section-title">قیمت خودکار</h2>
    <div class="note info"><span>منبع: TGJU (طلا ۱۸ عیار، دلار، تتر). قیمت قدیمی، صفر یا جهش مشکوک رد می‌شود و آخرین قیمت معتبر می‌ماند.</span>
      <button class="btn link" data-action="paste-open">چسباندن پاسخ TGJU (برای امتحان)</button></div>
    ${updateSection()}
    <h2 class="section-title">پشتیبانی</h2>
    <div class="note info">
      <span>برای پرسش، گزارش خطا یا پیشنهاد، در تلگرام پیام بدهید:</span>
      <b dir="ltr" style="font-size:1.1rem;user-select:all">${SUPPORT_ID}</b>
      <div class="actions">
        <a class="btn" href="${SUPPORT_URL}" target="_blank" rel="noopener noreferrer" data-action="support-open">باز کردن تلگرام</a>
        <button class="btn ghost" data-action="support-copy">کپی شناسه</button>
      </div>
    </div>
    <h2 class="section-title">داده‌ها</h2>
    <div class="actions">
      <button class="btn ghost" data-action="ask" data-v="reset">بازگشت به داده‌ی آزمایشی</button>
      <button class="btn ghost" data-action="ask" data-v="clear">پاک کردن همه‌ی داده‌ها</button>
    </div>
    <div class="note info"><span>این نسخه‌ی آزمایشی است. داده‌ها فقط در همین مرورگر نگه‌داری می‌شوند. قفل رمز، پشتیبان‌گیری و دریافت خودکار قیمت در مرحله‌ی سوم ساخته می‌شوند.</span></div>`;
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
interface PriceForm { assetId: string; price: string; error: string }
interface AssetForm {
  name: string; unit: string; decimals: string; preset: string; error: string;
  /** سهام بورس ایران: عبارت جست‌وجو، نتیجه‌ها، کد نماد در TSETMC و پیش‌نمایش قیمت */
  q: string; hits: InstrumentHit[]; insCode: string; preview: string; busy: boolean;
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
type Modal =
  | { kind: 'tx'; f: TxForm }
  | { kind: 'price'; f: PriceForm }
  | { kind: 'asset'; f: AssetForm }
  | { kind: 'debt'; f: DebtForm }
  | { kind: 'pay'; f: PayForm }
  | { kind: 'quote'; key: string }
  | { kind: 'paste'; f: { text: string; error: string } }
  | { kind: 'prices'; results: PriceResult[]; errors: { provider: string; message: string }[] }
  | { kind: 'ask'; what: 'reset' | 'clear' }
  | null;
let modal: Modal = null;

function closeModal() {
  modal = null;
  pendingTx = null;
  modalEl.innerHTML = '';
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
      break;
    }
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
        () => toast(`شناسه‌ی پشتیبانی: ${SUPPORT_ID}`),
      ) ?? toast(`شناسه‌ی پشتیبانی: ${SUPPORT_ID}`);
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
  modal = { kind: 'prices', results, errors: errors.map((e) => ({ provider: e.provider, message: friendlyError(e.message) })) };
  renderModal();
}

/* --- اتصال به اپ اندروید: وب‌ویو نمی‌تواند مستقیم به TGJU وصل شود، پس درخواست را به بخش بومی می‌دهد --- */
interface RNBridge { postMessage(msg: string): void }
type Pending = { resolve: (r: { ok: boolean; status: number; text(): Promise<string> }) => void; reject: (e: Error) => void };
const pendingFetch = new Map<string, Pending>();

function nativeFetch(url: string) {
  const rn = (window as unknown as { ReactNativeWebView?: RNBridge }).ReactNativeWebView;
  if (!rn) return fetch(url);
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
  __updateReply: (r: { ok: boolean; current: number; latest: number; url: string; size: number; notes: string; error: string }) => {
    upd.current = r.current;
    if (!r.ok) {
      upd.status = 'error';
      upd.error = r.error;
    } else if (r.latest > r.current && r.url) {
      Object.assign(upd, { status: 'available', latest: r.latest, url: r.url, size: r.size, notes: r.notes });
    } else upd.status = 'none';
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
async function runRefresh() {
  if (refreshing) return;
  refreshing = true;
  toast('در حال دریافت قیمت‌ها…');
  try {
    const providers = [tgjuProvider((u) => nativeFetch(u), undefined, undefined, (raw) => {
      store.market = { source: 'tgju', entries: parseMarket(raw) };
    })];
    const stockCodes = store.assets.map((a) => a.priceKeys?.tsetmc).filter((c): c is string => !!c);
    if (stockCodes.length) providers.push(tsetmcProvider((u) => nativeFetch(u), stockCodes));
    const out = await refreshPrices(store.assets, store.prices, providers, { now: Date.now() });
    showPriceResults(out.prices, out.results, out.errors);
  } finally {
    refreshing = false;
  }
}

function setErr(msg: string) {
  if (modal && modal.kind !== 'ask' && modal.kind !== 'prices' && modal.kind !== 'quote') (modal.f as { error: string }).error = msg;
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
  if (!field || !modal || modal.kind === 'ask' || modal.kind === 'prices' || modal.kind === 'quote') return;
  if (t.type === 'checkbox') {
    (modal.f as unknown as Record<string, boolean>)[field] = t.checked;
    if (field === 'plan') renderModal();
    return;
  }
  (modal.f as unknown as Record<string, string>)[field] = t.value;
  if (modal.kind === 'tx') {
    const live = document.getElementById('live');
    if (live) live.innerHTML = liveTotal(modal.f);
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target as HTMLSelectElement;
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

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && modal) closeModal();
});

render();
autoCheckUpdate();

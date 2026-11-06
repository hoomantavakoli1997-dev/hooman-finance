import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Decimal } from './decimal';
import {
  applyQuotes, parseTgju, PriceProvider, Quote, refreshPrices, tgjuProvider,
} from './prices';
import { Asset, PriceEntry } from './types';

/** پاسخ واقعی https://call.tgju.org/ajax.json که کاربر در ۱۴ آبان ۱۴۰۵ (۰۰:۳۸) ذخیره کرده است */
const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'tgju-ajax.sample.json'), 'utf8');
const NOW = Date.parse('2026-11-05T00:40:00+03:30');
const D = (v: string) => Decimal.parse(v);

const gold: Asset = { id: 'gold', name: 'طلا ۱۸ عیار', unit: 'گرم', kind: 'metal', decimals: 3 };
const usd: Asset = { id: 'usd', name: 'دلار', unit: 'دلار', kind: 'currency', decimals: 2 };
const usdt: Asset = { id: 'usdt', name: 'تتر', unit: 'تتر', kind: 'crypto', decimals: 2 };
const ASSETS = [gold, usd, usdt];

const find = (qs: Quote[], key: string) => qs.find((q) => q.key === key);

/* ------------------------------ تجزیه ------------------------------ */

test('TGJU: تجزیه‌ی پاسخ واقعی', () => {
  const qs = parseTgju(SAMPLE);
  assert.ok(qs.length > 1000);
  const g = find(qs, 'geram18')!;
  assert.ok(g.price.eq(D('260621000'))); // همان عدد روی صفحه‌ی کاربر
  assert.equal(g.dateOnly, true);
  assert.equal(g.at, '2026-11-04T00:00:00+03:30');
  assert.ok(find(qs, 'price_dollar_rl')!.price.eq(D('2689000')));
  assert.ok(find(qs, 'crypto-tether-irr')!.price.eq(D('2693840')));
  assert.ok(find(qs, 'mesghal')!.price.eq(D('1128990000')));
  const live = find(qs, 'tgju_gold_irg18')!;
  assert.ok(live.price.eq(D('258051000')));
  assert.equal(live.dateOnly, false);
  assert.equal(live.at, '2026-11-05T00:38:26+03:30');
});

test('TGJU: پاسخ ناقص یا خراب خطا می‌دهد', () => {
  assert.throws(() => parseTgju('not json'));
  assert.throws(() => parseTgju('{}'));
  assert.throws(() => parseTgju('{"current":[]}'));
  assert.throws(() => parseTgju('null'));
  // ورودی‌های خراب رد می‌شوند، نه حدس زده
  const qs = parseTgju({ current: { a: { p: 'abc', ts: '2026-11-04 00:00:00' }, b: { p: '5', ts: 'bad' }, c: { p: '1,234', ts: '2026-11-04 10:00:00' } } });
  assert.equal(qs.length, 1);
  assert.ok(qs[0].price.eq(D('1234')));
});

/* --------------------------- اعمال قیمت‌ها --------------------------- */

test('اعمال: طلا، دلار و تتر با کلیدهای پیش‌فرض', () => {
  const r = applyQuotes(ASSETS, {}, parseTgju(SAMPLE), { id: 'tgju', name: 'TGJU' }, { now: NOW });
  assert.deepEqual(r.results.map((x) => x.status), ['updated', 'updated', 'updated']);
  assert.ok(D(r.prices.gold.price).eq(D('260621000')));
  assert.ok(D(r.prices.usd.price).eq(D('2689000')));
  assert.ok(D(r.prices.usdt.price).eq(D('2693840')));
  const e = r.prices.gold;
  assert.equal(e.source, 'auto');
  assert.equal(e.provider, 'tgju');
  assert.equal(e.at, '2026-11-04T00:00:00+03:30');
  assert.equal(e.dateOnly, true);
  assert.equal(e.fetchedAt, new Date(NOW).toISOString());
});

test('تله‌ی قیمت قدیمی: usdt-irr مربوط به سال ۲۰۲۰ رد می‌شود', () => {
  const bad: Asset = { ...usdt, priceKeys: { tgju: 'usdt-irr' } };
  const r = applyQuotes([bad], {}, parseTgju(SAMPLE), { id: 'tgju', name: 'TGJU' }, { now: NOW });
  assert.equal(r.results[0].status, 'stale');
  assert.equal(r.prices.usdt, undefined);
});

test('قیمت قدیمی با گذشت چند روز رد می‌شود و آخرین قیمت می‌ماند', () => {
  const old: Record<string, PriceEntry> = {
    gold: { assetId: 'gold', price: '250000000', source: 'manual', at: '2026-11-01T10:00:00Z' },
  };
  const later = Date.parse('2026-11-20T10:00:00+03:30');
  const r = applyQuotes([gold], old, parseTgju(SAMPLE), { id: 'tgju', name: 'TGJU' }, { now: later });
  assert.equal(r.results[0].status, 'stale');
  assert.deepEqual(r.prices, old);
});

test('قیمت ساعت‌دار بیش از ۶ ساعت قدیمی است', () => {
  const qs = parseTgju(SAMPLE);
  const g: Asset = { ...gold, priceKeys: { tgju: 'tgju_gold_irg18' } };
  assert.equal(applyQuotes([g], {}, qs, { id: 'tgju', name: 'T' }, { now: NOW }).results[0].status, 'updated');
  assert.equal(
    applyQuotes([g], {}, qs, { id: 'tgju', name: 'T' }, { now: NOW + 7 * 3_600_000 }).results[0].status,
    'stale',
  );
});

test('دارایی بدون کلید یا با کلید ناموجود', () => {
  const custom: Asset = { id: 'c1', name: 'سکه', unit: 'عدد', kind: 'custom', decimals: 0 };
  const ghost: Asset = { ...custom, id: 'c2', priceKeys: { tgju: 'does_not_exist' } };
  const r = applyQuotes([custom, ghost], {}, parseTgju(SAMPLE), { id: 'tgju', name: 'TGJU' }, { now: NOW });
  assert.deepEqual(r.results.map((x) => x.status), ['no-key', 'missing']);
  assert.deepEqual(r.prices, {});
});

test('قیمت صفر یا منفی رد می‌شود', () => {
  const q: Quote = { key: 'geram18', price: D('0'), at: '2026-11-04T00:00:00+03:30', atMs: Date.parse('2026-11-04T00:00:00+03:30'), dateOnly: true };
  assert.equal(applyQuotes([gold], {}, [q], { id: 'tgju', name: 'T' }, { now: NOW }).results[0].status, 'invalid');
});

test('جهش مشکوک نسبت به قیمت خودکار قبلی رد می‌شود، نسبت به قیمت دستی نه', () => {
  const qs = parseTgju(SAMPLE);
  const auto: Record<string, PriceEntry> = {
    gold: { assetId: 'gold', price: '100000000', source: 'auto', at: '2026-11-03T00:00:00+03:30', provider: 'tgju' },
  };
  const a = applyQuotes([gold], auto, qs, { id: 'tgju', name: 'T' }, { now: NOW });
  assert.equal(a.results[0].status, 'suspicious');
  assert.deepEqual(a.prices, auto);
  const manual: Record<string, PriceEntry> = {
    gold: { assetId: 'gold', price: '100000000', source: 'manual', at: '2026-11-03T00:00:00Z' },
  };
  const m = applyQuotes([gold], manual, qs, { id: 'tgju', name: 'T' }, { now: NOW });
  assert.equal(m.results[0].status, 'updated');
  assert.equal(m.prices.gold.source, 'auto');
  // تغییر عادی (۵٪) پذیرفته می‌شود
  const near: Record<string, PriceEntry> = {
    gold: { assetId: 'gold', price: '248000000', source: 'auto', at: '2026-11-03T00:00:00+03:30', provider: 'tgju' },
  };
  assert.equal(applyQuotes([gold], near, qs, { id: 'tgju', name: 'T' }, { now: NOW }).results[0].status, 'updated');
});

test('اعمال دوباره‌ی همان قیمت «بدون تغییر» است', () => {
  const qs = parseTgju(SAMPLE);
  const p = { id: 'tgju', name: 'T' };
  const first = applyQuotes(ASSETS, {}, qs, p, { now: NOW });
  const second = applyQuotes(ASSETS, first.prices, qs, p, { now: NOW + 60_000 });
  assert.deepEqual(second.results.map((x) => x.status), ['unchanged', 'unchanged', 'unchanged']);
  assert.deepEqual(second.prices, first.prices);
});

/* ------------------------- چند منبع و خطاها ------------------------- */

const fakeProvider = (id: string, quotes: Quote[] | Error): PriceProvider => ({
  id, name: id,
  async fetchQuotes() {
    if (quotes instanceof Error) throw quotes;
    return quotes;
  },
});
const quoteAt = (key: string, price: string): Quote => ({
  key, price: D(price), at: '2026-11-05T00:30:00+03:30', atMs: Date.parse('2026-11-05T00:30:00+03:30'), dateOnly: false,
});

test('اگر منبع اول خطا بدهد، منبع دوم جایش را می‌گیرد', async () => {
  const usdtB: Asset = { ...usdt, priceKeys: { tgju: 'crypto-tether-irr', bitpin: 'USDT_IRT' } };
  const out = await refreshPrices(
    [usdtB], {},
    [fakeProvider('tgju', new Error('شبکه قطع است')), fakeProvider('bitpin', [quoteAt('USDT_IRT', '2690000')])],
    { now: NOW },
  );
  assert.equal(out.results[0].status, 'updated');
  assert.equal(out.prices.usdt.provider, 'bitpin');
  assert.ok(D(out.prices.usdt.price).eq(D('2690000')));
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].provider, 'tgju');
});

test('اگر همه‌ی منبع‌ها خطا بدهند، قیمت‌های قبلی دست‌نخورده می‌مانند', async () => {
  const before: Record<string, PriceEntry> = {
    gold: { assetId: 'gold', price: '250000000', source: 'manual', at: '2026-11-01T10:00:00Z' },
  };
  const out = await refreshPrices([gold], before, [fakeProvider('tgju', new Error('x')), fakeProvider('b', new Error('y'))], { now: NOW });
  assert.deepEqual(out.prices, before);
  assert.equal(out.results[0].status, 'failed');
  assert.equal(out.errors.length, 2);
});

test('منبع دوم فقط برای دارایی‌هایی که هنوز قیمت نگرفته‌اند امتحان می‌شود', async () => {
  const both: Asset = { ...usdt, priceKeys: { tgju: 'crypto-tether-irr', bitpin: 'USDT_IRT' } };
  const out = await refreshPrices(
    [gold, both], {},
    [tgjuProvider(async () => ({ ok: true, status: 200, text: async () => SAMPLE })), fakeProvider('bitpin', [quoteAt('USDT_IRT', '1')])],
    { now: NOW },
  );
  assert.equal(out.prices.usdt.provider, 'tgju');
  assert.ok(D(out.prices.usdt.price).eq(D('2693840')));
});

test('tgjuProvider: پاسخ ناموفق و کند', async () => {
  await assert.rejects(tgjuProvider(async () => ({ ok: false, status: 503, text: async () => '' })).fetchQuotes(), /503/);
  await assert.rejects(tgjuProvider(async () => ({ ok: true, status: 200, text: async () => '<html>' })).fetchQuotes(), /JSON/);
  await assert.rejects(
    tgjuProvider(() => new Promise(() => { /* هرگز تمام نمی‌شود */ }), 'x', 30).fetchQuotes(),
    /زمان تمام شد/,
  );
});

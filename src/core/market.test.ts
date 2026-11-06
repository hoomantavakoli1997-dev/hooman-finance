import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { classify, isStale, parseMarket, searchMarket, snapshotTime } from './market';
import { parseTgju } from './prices';

const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'tgju-ajax.sample.json'), 'utf8');
const NOW = Date.parse('2026-11-05T00:40:00+03:30');
const ENTRIES = parseMarket(SAMPLE);
const get = (k: string) => ENTRIES.find((e) => e.key === k)!;

test('تجزیه: همه‌ی ورودی‌های معتبر پاسخ واقعی', () => {
  assert.equal(ENTRIES.length, parseTgju(SAMPLE).length);
  const g = get('geram18');
  assert.equal(g.price, '260621000');
  assert.equal(g.high, '261104000');
  assert.equal(g.low, '255102000');
  assert.equal(g.dateOnly, true);
  assert.equal(g.dir, '');
  const live = get('tgju_gold_irg18');
  assert.equal(live.dir, 'up');
  assert.equal(live.changePct, 0.03);
  assert.equal(live.change, '70000');
  assert.equal(get('price_dollar_rl').price, '2689000'); // جداکننده‌ی هزارگان حذف می‌شود
  assert.equal(get('crypto-bitcoin').price, '80179.98');
});

test('تجزیه: ورودی خراب خطا می‌دهد', () => {
  assert.throws(() => parseMarket('x'));
  assert.throws(() => parseMarket('{}'));
});

test('واحدها: ریال، دلار و نامشخص', () => {
  assert.equal(classify('geram18').unit, 'irr');
  assert.equal(classify('crypto-bitcoin').unit, 'usd');
  assert.equal(classify('crypto-bitcoin-irr').unit, 'irr');
  assert.equal(classify('crypto-tether-irr').unit, 'irr');
  assert.equal(classify('ons').unit, 'usd');
  assert.equal(classify('price_eur').unit, 'irr');
  assert.equal(classify('price_eur').title, 'یورو');
  assert.equal(classify('price_jpy').per, 'هر ۱۰۰ ین');
  assert.equal(classify('sarafiyaran_usd_sell').unit, 'irr');
  // واحد نامشخص حدس زده نمی‌شود
  for (const k of ['ime_fund_zar', 'copperp', 'diff_usd_try', 'usd-try-ask', 'sekee_real', 'gold_17', 'weird_key']) {
    assert.equal(classify(k).unit, 'none', k);
  }
});

test('بزرگی عددها با واحدِ اعلام‌شده می‌خواند', () => {
  // بیت‌کوین ریالی ≈ بیت‌کوین دلاری × دلار
  const usdBtc = Number(get('crypto-bitcoin').price);
  const irrBtc = Number(get('crypto-bitcoin-irr').price);
  const dollar = Number(get('price_dollar_rl').price);
  assert.ok(Math.abs(irrBtc / (usdBtc * dollar) - 1) < 0.02);
  // ین: هر ۱۰۰ ین ≈ ۱۰۰ × دلار ÷ نرخ دلار-ین
  const jpy = Number(get('price_jpy').price);
  const usdJpy = Number(get('usd-jpy-ask').price);
  assert.ok(Math.abs(jpy / ((100 * dollar) / usdJpy) - 1) < 0.02);
});

test('دسته‌ها و نام‌ها', () => {
  assert.equal(classify('geram18').category, 'gold');
  assert.equal(classify('sekee').title, 'سکه امامی');
  assert.equal(classify('retail_rob').title, 'ربع‌سکه (خرده‌فروشی)');
  assert.equal(classify('crypto-ripple-irr').title, 'ریپل');
  assert.equal(classify('crypto-uniswap').title, 'Uniswap');
  assert.equal(classify('price_dollar_rl').category, 'currency');
  assert.equal(classify('oil_brent').category, 'metal');
  assert.equal(classify('ime_fund_zar').category, 'ime');
  assert.equal(classify('price_zzz').title, 'ارز ZZZ');
});

test('کهنگی: قیمت‌های سال ۲۰۲۰ و ۲۰۱۸ قدیمی‌اند، قیمت امروز نه', () => {
  assert.equal(isStale(get('usdt-irr'), NOW), true);
  assert.equal(isStale(get('sekee_buy'), NOW), true);
  assert.equal(isStale(get('geram18'), NOW), false);
  assert.equal(isStale(get('tgju_gold_irg18'), NOW), false);
  assert.equal(isStale(get('tgju_gold_irg18'), NOW + 7 * 3_600_000), true);
  const stale = ENTRIES.filter((e) => isStale(e, NOW)).length;
  assert.ok(stale > 300 && stale < ENTRIES.length);
});

test('زمان داده', () => {
  // تازه‌ترین قیمت ساعت‌دار در فایل نمونه (silver)
  assert.equal(snapshotTime(ENTRIES), Date.parse('2026-11-05T00:38:27+03:30'));
});

test('جست‌وجو: فارسی، کلید، دسته و قدیمی‌ها', () => {
  const q = (text: string, category: 'all' | 'gold' | 'crypto' = 'all', includeStale = false) =>
    searchMarket(ENTRIES, { text, category, includeStale, now: NOW }).map((e) => e.key);
  assert.ok(q('بیت‌کوین').includes('crypto-bitcoin'));
  assert.ok(q('بیت‌کوین').includes('crypto-bitcoin-irr'));
  assert.ok(q('geram18').includes('geram18'));
  assert.ok(q('۱۸').includes('geram18')); // رقم فارسی
  assert.ok(q('یورو').includes('price_eur'));
  assert.ok(q('', 'crypto').every((k) => classify(k).category === 'crypto'));
  assert.ok(!q('').includes('usdt-irr')); // قدیمی پنهان است
  assert.ok(q('usdt-irr', 'all', true).includes('usdt-irr')); // با گزینه‌ی قدیمی‌ها دیده می‌شود
  // ترتیب: قیمت‌های تازه‌ی دارای نام فارسی اول می‌آیند
  const all = q('', 'all', true);
  const firstStale = all.findIndex((k) => isStale(get(k), NOW));
  assert.ok(all.slice(firstStale).every((k) => isStale(get(k), NOW)));
  assert.equal(classify(all[0]).named, true);
  // مهم‌ترین قیمت‌ها اول و به همان ترتیب می‌آیند، بعد طلا و سکه
  const fresh = q('');
  assert.deepEqual(fresh.slice(0, 5), ['geram18', 'price_dollar_rl', 'crypto-tether-irr', 'sekee', 'mesghal']);
  assert.equal(classify(fresh[7]).category, 'gold');
});

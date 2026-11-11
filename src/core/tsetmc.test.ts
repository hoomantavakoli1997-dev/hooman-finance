import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyQuotes } from './prices';
import {
  fromTsetmcText, isInsCode, parseClosingInfo, parseSearch, quoteUrl, searchUrl, toTsetmcText, tsetmcProvider,
} from './tsetmc';
import type { Asset } from './types';

// نمونه‌های ساختگی بر اساس فرمتی که کتابخانه‌های متن‌باز مستند کرده‌اند (نه پاسخ زنده)
const INFO = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ closingPriceInfo: { pDrCotVal: 3500, pClosing: 3480, priceYesterday: 3400, dEven: 20261104, hEven: 101530, ...over } });
const SEARCH = JSON.stringify({
  instrumentSearch: [
    { insCode: '35425587644337450', lVal18AFC: 'فملي', lVal30: 'ملي صنايع مس ايران' },
    { insCode: 'bad', lVal18AFC: 'x', lVal30: 'y' },
  ],
});

const stock: Asset = { id: 'a1', name: 'فملی', unit: 'سهم', kind: 'custom', decimals: 0, priceKeys: { tsetmc: '35425587644337450' } };

test('آدرس‌ها و تبدیل حرف‌های فارسی/عربی', () => {
  assert.equal(toTsetmcText('فملی'), 'فملي');
  assert.equal(toTsetmcText('کروی'), 'كروي');
  assert.equal(fromTsetmcText('فملي'), 'فملی');
  assert.ok(searchUrl('فملی').endsWith('/GetInstrumentSearch/' + encodeURIComponent('فملي')));
  assert.equal(quoteUrl('35425587644337450'), 'https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceInfo/35425587644337450');
  assert.throws(() => quoteUrl('../x'));
  assert.equal(isInsCode('123'), false);
});

test('جست‌وجو: فقط موارد معتبر و نام فارسی‌شده', () => {
  const r = parseSearch(SEARCH);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { insCode: '35425587644337450', symbol: 'فملی', name: 'ملی صنایع مس ایران' });
  assert.throws(() => parseSearch('{}'));
  assert.throws(() => parseSearch('x'));
});

test('قیمت: آخرین معامله، زمان تهران، رد پاسخ ناقص', () => {
  const q = parseClosingInfo(INFO(), '35425587644337450');
  assert.equal(q.price.toString(), '3500');
  assert.equal(q.at, '2026-11-04T10:15:30+03:30');
  assert.equal(q.closing?.toString(), '3480');
  assert.equal(q.yesterday?.toString(), '3400');
  // ساعت بدون صفر ابتدایی (۹:۰۰:۰۱)
  assert.equal(parseClosingInfo(INFO({ hEven: 90001 }), '1'.repeat(8)).at, '2026-11-04T09:00:01+03:30');
  // اگر آخرین معامله صفر بود، قیمت پایانی
  assert.equal(parseClosingInfo(INFO({ pDrCotVal: 0 }), '1'.repeat(8)).price.toString(), '3480');
  // هیچ قیمتی نبود، یا تاریخ نبود: خطا
  assert.throws(() => parseClosingInfo(INFO({ pDrCotVal: 0, pClosing: 0 }), '1'.repeat(8)));
  assert.throws(() => parseClosingInfo(INFO({ dEven: undefined }), '1'.repeat(8)));
  assert.throws(() => parseClosingInfo(INFO({ pDrCotVal: '3500' as unknown as number, pClosing: null }), '1'.repeat(8)));
  assert.throws(() => parseClosingInfo('{"closingPriceInfo":null}', '1'.repeat(8)));
});

test('اعمال قیمت: تازه می‌شود، قدیمی و جهش مشکوک رد می‌شود', () => {
  const q = parseClosingInfo(INFO(), '35425587644337450');
  const now = Date.parse('2026-11-05T12:00:00+03:30');
  const prov = { id: 'tsetmc', name: 'بورس' };
  const ok = applyQuotes([stock], {}, [q], prov, { now });
  assert.equal(ok.results[0].status, 'updated');
  assert.equal(ok.prices.a1.price, '3500');
  assert.equal(ok.prices.a1.source, 'auto');
  // ۱۰ روز بعد: قدیمی
  const old = applyQuotes([stock], {}, [q], prov, { now: now + 10 * 86400e3 });
  assert.equal(old.results[0].status, 'stale');
  // جهش ۵۰٪ نسبت به قیمت خودکار قبلی
  const jump = parseClosingInfo(INFO({ pDrCotVal: 5300 }), '35425587644337450');
  const sus = applyQuotes([stock], ok.prices, [jump], prov, { now });
  assert.equal(sus.results[0].status, 'suspicious');
});

test('ارائه‌دهنده: خطای یک نماد جلوی بقیه را نمی‌گیرد؛ همه خراب = خطا', async () => {
  const good = '35425587644337450', bad = '12345678';
  const f = async (url: string) =>
    url.endsWith(good) ? { ok: true, status: 200, text: async () => INFO() } : { ok: false, status: 500, text: async () => '' };
  const q = await tsetmcProvider(f, [good, bad, 'zz']).fetchQuotes();
  assert.equal(q.length, 1);
  await assert.rejects(() => tsetmcProvider(f, [bad]).fetchQuotes());
  assert.deepEqual(await tsetmcProvider(f, []).fetchQuotes(), []);
});

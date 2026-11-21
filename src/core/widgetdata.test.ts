import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketEntry } from './market';
import { buildRows, sanitizeConfig } from '../native/widgetData';

const e = (key: string, price: string, dir: 'up' | 'down' | '' = '', pct = 0): MarketEntry =>
  ({ key, price, high: price, low: price, change: '0', changePct: pct, dir, at: '2026-11-21T10:00:00', atMs: 0, dateOnly: false });

test('ردیف‌ها به ترتیب کلیدها و فقط برای کلیدهای موجود', () => {
  const rows = buildRows([e('price_dollar_rl', '1000000', 'up', 1.5), e('geram18', '50000000')], ['geram18', 'nope', 'price_dollar_rl'], 'toman');
  assert.equal(rows.length, 2);
  assert.ok(rows[0].price.includes('۵٬۰۰۰٬۰۰۰') && rows[0].price.includes('تومان'));
  assert.ok(rows[1].change.includes('▲') && rows[1].change.includes('۱٫۵'));
});

test('واحد ریال و سقف تعداد ردیف', () => {
  const keys = Array.from({ length: 10 }, (_, i) => 'k' + i);
  assert.equal(buildRows(keys.map((k) => e(k, '10')), keys, 'rial').length, 6);
  assert.ok(buildRows([e('geram18', '50000000')], ['geram18'], 'rial')[0].price.includes('ریال'));
});

test('sanitizeConfig: ورودی خراب رد می‌شود و سرمایه بدون رضایت نمی‌آید', () => {
  assert.equal(sanitizeConfig(null), null);
  const c = sanitizeConfig({ keys: ['a', 5], unit: 'x', showWorth: false, worth: '۱۰۰', rows: [{ label: 'l', price: 'p', change: '', dir: 'zzz' }] })!;
  assert.deepEqual(c.keys, ['a']);
  assert.equal(c.worth, null);
  assert.equal(c.unit, 'toman');
  assert.equal(c.rows[0].dir, '');
  assert.equal(sanitizeConfig({ showWorth: true, worth: '۱۰۰' })!.worth, '۱۰۰');
});

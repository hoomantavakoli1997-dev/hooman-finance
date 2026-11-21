import test from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from './decimal';
import { Quote } from './prices';
import { BgAlert, dropFired, evaluateAlerts, hitText, sanitizeBg } from '../native/bgAlerts';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const q = (price: string, ageMs = 0): Quote => ({ key: 'k', price: Decimal.of(price), at: '', atMs: NOW - ageMs, dateOnly: false });
const alert = (over: Partial<BgAlert> = {}): BgAlert => ({ id: 'a1', assetName: 'طلا', side: 'sell', cond: 'above', target: '1000', provider: 'tgju', key: 'geram18', ...over });

test('بالاتر از هدف هشدار می‌دهد، پایین‌تر نه', () => {
  const m = new Map([['tgju:geram18', q('1000')]]);
  assert.equal(evaluateAlerts([alert()], m, NOW).length, 1);
  assert.equal(evaluateAlerts([alert({ target: '1001' })], m, NOW).length, 0);
  assert.equal(evaluateAlerts([alert({ cond: 'below', target: '1000' })], m, NOW).length, 1);
});

test('قیمت قدیمی، صفر یا نبودن قیمت هشدار کاذب نمی‌دهد', () => {
  assert.equal(evaluateAlerts([alert()], new Map([['tgju:geram18', q('5000', 4 * 86_400_000)]]), NOW).length, 0);
  assert.equal(evaluateAlerts([alert({ cond: 'below' })], new Map([['tgju:geram18', q('0')]]), NOW).length, 0);
  assert.equal(evaluateAlerts([alert()], new Map(), NOW).length, 0);
});

test('منبع تفکیک می‌شود: کلید tsetmc با tgju قاطی نمی‌شود', () => {
  const m = new Map([['tgju:123', q('5000')]]);
  assert.equal(evaluateAlerts([alert({ provider: 'tsetmc', key: '123' })], m, NOW).length, 0);
});

test('متن اعلان و واحد', () => {
  const h = evaluateAlerts([alert()], new Map([['tgju:geram18', q('1500000')]]), NOW)[0];
  assert.ok(hitText(h, 'toman').body.includes('۱۵۰٬۰۰۰ تومان'));
  assert.ok(hitText(h, 'rial').title.startsWith('وقت فروش'));
});

test('sanitizeBg ورودی خراب را رد می‌کند', () => {
  assert.equal(sanitizeBg(null), null);
  const c = sanitizeBg({ alerts: [alert(), { ...alert(), id: 'bad', target: 'abc' }, { ...alert(), id: 'b2', provider: 'x' }, { id: 'zz' }], fired: ['a', 3] })!;
  assert.equal(c.alerts.length, 1);
  assert.deepEqual(c.fired, ['a']);
});

test('dropFired', () => {
  assert.deepEqual(dropFired([alert(), alert({ id: 'a2' })], ['a1']).map((a) => a.id), ['a2']);
});

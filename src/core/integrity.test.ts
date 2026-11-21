import test from 'node:test';
import assert from 'node:assert/strict';
import { isIntegrityOk } from '../native/integrity';

test('quick_check سالم: ستون quick_check برابر ok', () => {
  assert.equal(isIntegrityOk({ quick_check: 'ok' }), true);
});
test('نام ستون قدیمی هم قبول است ولی فقط با مقدار ok', () => {
  assert.equal(isIntegrityOk({ integrity_check: 'ok' }), true);
  assert.equal(isIntegrityOk({ quick_check: '*** in database main ***' }), false);
});
test('نبودن نتیجه یا ردیف چندستونه سالم حساب نمی‌شود', () => {
  assert.equal(isIntegrityOk(null), false);
  assert.equal(isIntegrityOk(undefined), false);
  assert.equal(isIntegrityOk({}), false);
  assert.equal(isIntegrityOk({ a: 'ok', b: 'ok' }), false);
  assert.equal(isIntegrityOk('ok'), false);
});

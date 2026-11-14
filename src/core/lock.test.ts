import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPin, hashSecret, isValidPattern, isValidPin, lockoutMs, normalizePin, verifyPin, verifySecret } from './lock';

test('رمز درست باز می‌کند و رمز غلط نه', async () => {
  const rec = await hashPin('4827');
  assert.equal(rec.len, 4);
  assert.equal(await verifyPin('4827', rec), true);
  assert.equal(await verifyPin('4828', rec), false);
  assert.equal(await verifyPin('482', rec), false);
});

test('ارقام فارسی و لاتین یکی‌اند', async () => {
  const rec = await hashPin('۱۲۰۹۸۷');
  assert.equal(rec.len, 6);
  assert.equal(await verifyPin('120987', rec), true);
  assert.equal(normalizePin('٣٤٥٦'), '3456');
});

test('رمز ذخیره نمی‌شود و salt هر بار فرق دارد', async () => {
  const a = await hashPin('5555');
  const b = await hashPin('5555');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.ok(!JSON.stringify(a).includes('5555'));
});

test('اعتبار رمز: فقط ۴ تا ۶ رقم', async () => {
  for (const ok of ['1234', '12345', '123456', '۱۲۳۴']) assert.ok(isValidPin(ok), ok);
  for (const bad of ['123', '1234567', 'abcd', '12 34', '', '12.4']) assert.ok(!isValidPin(bad), bad);
  await assert.rejects(hashPin('12'), /۴|4/);
});

test('مهلت بعد از اشتباه: فزاینده با سقف', () => {
  assert.equal(lockoutMs(0), 0);
  assert.equal(lockoutMs(4), 0);
  assert.equal(lockoutMs(5), 30_000);
  assert.equal(lockoutMs(6), 60_000);
  assert.equal(lockoutMs(7), 120_000);
  assert.equal(lockoutMs(30), 15 * 60_000);
});

test('رکورد خراب یا دست‌کاری‌شده رد می‌شود', async () => {
  const rec = await hashPin('9090');
  assert.equal(await verifyPin('9090', { ...rec, hash: rec.hash.replace(/.$/, rec.hash.endsWith('A') ? 'B' : 'A') }), false);
});

test('الگو: اعتبار و رفت‌وبرگشت', async () => {
  for (const ok of ['1478', '14789', '159367', '123456789']) assert.ok(isValidPattern(ok), ok);
  for (const bad of ['147', '1123', '12345678901', '1203', 'abcd', '']) assert.ok(!isValidPattern(bad), bad);
  const rec = await hashSecret('14785', 'pattern');
  assert.equal(rec.kind, 'pattern');
  assert.equal(await verifySecret('14785', rec), true);
  assert.equal(await verifySecret('14786', rec), false);
  assert.equal(await verifySecret('5874', rec), false);
  assert.ok(!JSON.stringify(rec).includes('14785'));
  await assert.rejects(hashSecret('1123', 'pattern'));
});

test('الگوی ۷ نقطه‌ای با قفل رمز عددی اشتباه گرفته نمی‌شود', async () => {
  const pin = await hashPin('1234');
  assert.equal(await verifySecret('1234567', pin), false);
  const pat = await hashSecret('1236547', 'pattern');
  assert.equal(await verifySecret('1236547', pat), true);
  assert.equal(await verifySecret('123654', pat), false);
});

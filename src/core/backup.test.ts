import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackupError, decryptBackup, encryptBackup, normalizePassphrase } from './backup';

const sample = JSON.stringify({ app: 'x', store: { assets: [{ id: 'gold', name: 'طلا ۱۸ عیار' }], n: '123456789012345678901234567890' } });

test('رفت‌وبرگشت: متن فارسی و عدد بزرگ بدون تغییر برمی‌گردد', async () => {
  const f = await encryptBackup(sample, 'رمز-امن-۱۲۳');
  assert.equal(await decryptBackup(f, 'رمز-امن-۱۲۳'), sample);
});

test('پشتیبان رمزدار است: متن اصلی داخل فایل دیده نمی‌شود', async () => {
  const f = await encryptBackup(sample, 'secret1');
  assert.ok(!f.includes('gold') && !f.includes('طلا'));
  assert.equal(JSON.parse(f).format, 'hooman-finance-backup');
});

test('رمز اشتباه رد می‌شود', async () => {
  const f = await encryptBackup(sample, 'secret1');
  await assert.rejects(decryptBackup(f, 'secret2'), (e) => e instanceof BackupError && /رمز اشتباه/.test(e.message));
});

test('دست‌کاری فایل شناسایی می‌شود', async () => {
  const o = JSON.parse(await encryptBackup(sample, 'secret1'));
  const b = Buffer.from(o.data, 'base64');
  b[0] ^= 1;
  o.data = b.toString('base64');
  await assert.rejects(decryptBackup(JSON.stringify(o), 'secret1'), BackupError);
});

test('ارقام فارسی و لاتین در رمز یکی حساب می‌شوند', async () => {
  assert.equal(normalizePassphrase('ab۱۲۳'), 'ab123');
  assert.equal(normalizePassphrase('ab١٢٣'), 'ab123');
  const f = await encryptBackup(sample, 'pass۱۲۳۴');
  assert.equal(await decryptBackup(f, 'pass1234'), sample);
});

test('رمز کوتاه و فایل غیرپشتیبان رد می‌شود', async () => {
  await assert.rejects(encryptBackup(sample, '123'), BackupError);
  await assert.rejects(decryptBackup('hello', 'secret1'), /فایل پشتیبان برنامه نیست/);
  await assert.rejects(decryptBackup('{"format":"other"}', 'secret1'), BackupError);
});

test('هر بار salt و iv تازه است', async () => {
  const a = JSON.parse(await encryptBackup(sample, 'secret1'));
  const b = JSON.parse(await encryptBackup(sample, 'secret1'));
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
});

/**
 * فایل پشتیبان رمزدار.
 * - رمز هرگز ذخیره یا فرستاده نمی‌شود؛ کلید از رمز با PBKDF2-SHA256 (۳۱۰٬۰۰۰ دور) ساخته می‌شود.
 * - رمزنگاری: AES-256-GCM؛ برچسب GCM هم رمز اشتباه و هم دست‌کاری فایل را تشخیص می‌دهد.
 * - هر بار salt و iv تازه‌ی تصادفی؛ بنابراین دو پشتیبان از یک داده یکسان نیستند.
 * بدون وابستگی به DOM: فقط از WebCrypto (globalThis.crypto) استفاده می‌کند.
 */

const FORMAT = 'hooman-finance-backup';
const VERSION = 1;
const ITERATIONS = 310_000;
export const MIN_PASSPHRASE = 6;

export class BackupError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new BackupError('رمزنگاری در این مرورگر در دسترس نیست.');
  return c.subtle;
}

function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  (globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(a);
  return a;
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** رمز را یکدست می‌کند: ارقام فارسی/عربی ← لاتین و یونیکد NFKC؛ تا با هر کیبوردی همان رمز باز شود */
export function normalizePassphrase(p: string): string {
  return p
    .normalize('NFKC')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

async function deriveKey(pass: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(normalizePassphrase(pass)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptBackup(plain: string, pass: string): Promise<string> {
  if (normalizePassphrase(pass).length < MIN_PASSPHRASE) throw new BackupError(`رمز باید دست‌کم ${MIN_PASSPHRASE} نویسه باشد.`);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(pass, salt, ITERATIONS);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(plain)));
  return JSON.stringify({ format: FORMAT, v: VERSION, kdf: 'PBKDF2-SHA256', iter: ITERATIONS, salt: toB64(salt), iv: toB64(iv), data: toB64(ct) });
}

export async function decryptBackup(text: string, pass: string): Promise<string> {
  let o: { format?: unknown; v?: unknown; iter?: unknown; salt?: unknown; iv?: unknown; data?: unknown };
  try {
    o = JSON.parse(text.trim());
  } catch {
    throw new BackupError('این فایل، فایل پشتیبان برنامه نیست.');
  }
  if (!o || o.format !== FORMAT) throw new BackupError('این فایل، فایل پشتیبان برنامه نیست.');
  if (o.v !== VERSION) throw new BackupError('این پشتیبان با نسخه‌ی دیگری از برنامه ساخته شده است.');
  const iter = Number(o.iter);
  if (!Number.isInteger(iter) || iter < 100_000 || iter > 2_000_000 || typeof o.salt !== 'string' || typeof o.iv !== 'string' || typeof o.data !== 'string') {
    throw new BackupError('فایل پشتیبان خراب است.');
  }
  try {
    const key = await deriveKey(pass, fromB64(o.salt), iter);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(o.iv) as BufferSource }, key, fromB64(o.data) as BufferSource);
    return dec.decode(pt);
  } catch {
    throw new BackupError('رمز اشتباه است یا فایل خراب شده است.');
  }
}

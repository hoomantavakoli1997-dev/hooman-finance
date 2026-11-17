/**
 * فایل پشتیبان رمزدار.
 * - رمز هرگز ذخیره یا فرستاده نمی‌شود؛ کلید از رمز با PBKDF2-SHA256 (۳۱۰٬۰۰۰ دور) ساخته می‌شود.
 * - رمزنگاری: AES-256-GCM؛ برچسب GCM هم رمز اشتباه و هم دست‌کاری فایل را تشخیص می‌دهد.
 * - هر بار salt و iv تازه‌ی تصادفی؛ بنابراین دو پشتیبان از یک داده یکسان نیستند.
 * بدون وابستگی به DOM: فقط از WebCrypto (globalThis.crypto) استفاده می‌کند.
 */

const FORMAT = 'hooman-finance-backup';
const VERSION = 1;
const KDF = 'PBKDF2-SHA256';
const ITERATIONS = 310_000;
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 2_000_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const MIN_PASSPHRASE = 6;

export class BackupError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new BackupError('رمزنگاری در این مرورگر در دسترس نیست.');
  return c.subtle;
}

function randomBytes(n: number): Uint8Array {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.getRandomValues) throw new BackupError('تولید عدد تصادفی امن در دسترس نیست.');
  const a = new Uint8Array(n);
  c.getRandomValues(a);
  return a;
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64)) {
    throw new BackupError('فایل پشتیبان خراب است.');
  }
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
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(pass, salt, ITERATIONS);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(plain)));
  return JSON.stringify({ format: FORMAT, v: VERSION, kdf: KDF, iter: ITERATIONS, salt: toB64(salt), iv: toB64(iv), data: toB64(ct) });
}

export async function decryptBackup(text: string, pass: string): Promise<string> {
  let o: { format?: unknown; v?: unknown; kdf?: unknown; iter?: unknown; salt?: unknown; iv?: unknown; data?: unknown };
  try {
    o = JSON.parse(text.trim());
  } catch {
    throw new BackupError('این فایل، فایل پشتیبان برنامه نیست.');
  }
  if (!o || o.format !== FORMAT) throw new BackupError('این فایل، فایل پشتیبان برنامه نیست.');
  if (o.v !== VERSION) throw new BackupError('این پشتیبان با نسخه‌ی دیگری از برنامه ساخته شده است.');
  const iter = Number(o.iter);
  if (o.kdf !== KDF || !Number.isInteger(iter) || iter < MIN_ITERATIONS || iter > MAX_ITERATIONS ||
      typeof o.salt !== 'string' || typeof o.iv !== 'string' || typeof o.data !== 'string') {
    throw new BackupError('پارامترهای فایل پشتیبان معتبر نیستند.');
  }
  try {
    const salt = fromB64(o.salt);
    const iv = fromB64(o.iv);
    const data = fromB64(o.data);
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || data.length < TAG_BYTES) {
      throw new BackupError('فایل پشتیبان ناقص یا خراب است.');
    }
    const key = await deriveKey(pass, salt, iter);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource);
    return dec.decode(pt);
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError('رمز اشتباه است یا فایل خراب شده است.');
  }
}

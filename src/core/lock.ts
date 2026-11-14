/**
 * قفل برنامه: رمز عددی ۴ تا ۶ رقمی.
 * - رمز ذخیره نمی‌شود؛ فقط salt و هش PBKDF2-SHA256 (۱۵۰٬۰۰۰ دور).
 * - مقایسه‌ی زمان‌ثابت و مهلت فزاینده بعد از اشتباه‌های پیاپی.
 * توجه: این قفل جلوی دسترسی عادی به برنامه را می‌گیرد؛ داده‌ی داخل گوشی را رمزگذاری نمی‌کند.
 */

export const PIN_MIN = 4;
export const PIN_MAX = 6;
const ITER = 150_000;

export type LockKind = 'pin' | 'pattern';
export const PATTERN_MIN = 4;

export interface PinRecord {
  /** نوع قفل؛ اگر نباشد «رمز عددی» است */
  kind?: LockKind;
  salt: string;
  hash: string;
  iter: number;
  /** تعداد رقم‌ها؛ برای بازشدن خودکار هنگام تایپ آخرین رقم */
  len: number;
}

const enc = new TextEncoder();

/** ارقام فارسی/عربی را لاتین می‌کند؛ هر نویسه‌ی غیررقم را حذف نمی‌کند، تا رمز نامعتبر ساده رد شود */
export function normalizePin(p: string): string {
  return p
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

export function isValidPin(p: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(normalizePin(p));
}

/** الگو: دنباله‌ی شماره‌ی نقطه‌ها (۱ تا ۹، چپ‌به‌راست و بالا به پایین)، بدون تکرار، دست‌کم ۴ نقطه */
export function isValidPattern(p: string): boolean {
  return /^[1-9]{4,9}$/.test(p) && new Set(p).size === p.length;
}

export function isValidSecret(secret: string, kind: LockKind = 'pin'): boolean {
  return kind === 'pattern' ? isValidPattern(secret) : isValidPin(secret);
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const r = atob(s);
  const o = new Uint8Array(r.length);
  for (let i = 0; i < r.length; i++) o[i] = r.charCodeAt(i);
  return o;
}

async function derive(pin: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error('رمزنگاری در این مرورگر در دسترس نیست.');
  const key = await c.subtle.importKey('raw', enc.encode(normalizePin(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await c.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, key, 256);
  return new Uint8Array(bits);
}

export async function hashSecret(secret: string, kind: LockKind = 'pin'): Promise<PinRecord> {
  if (!isValidSecret(secret, kind)) throw new Error(kind === 'pattern' ? `الگو باید دست‌کم ${PATTERN_MIN} نقطه‌ی غیرتکراری باشد.` : `رمز باید ${PIN_MIN} تا ${PIN_MAX} رقم باشد.`);
  const salt = new Uint8Array(16);
  (globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(salt);
  const hash = await derive(secret, salt, ITER);
  return { kind, salt: b64(salt), hash: b64(hash), iter: ITER, len: normalizePin(secret).length };
}

export async function verifySecret(secret: string, rec: PinRecord): Promise<boolean> {
  if (!isValidSecret(secret, rec.kind ?? 'pin')) return false;
  const got = await derive(secret, unb64(rec.salt), rec.iter);
  const want = unb64(rec.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

export const hashPin = (pin: string): Promise<PinRecord> => hashSecret(pin, 'pin');
export const verifyPin = verifySecret;

/** مهلت بعد از اشتباه‌های پیاپی: ۴ اشتباه آزاد؛ از پنجمی ۳۰ ثانیه و هر بار دو برابر تا سقف ۱۵ دقیقه */
export function lockoutMs(fails: number): number {
  if (fails < 5) return 0;
  return Math.min(30_000 * 2 ** (fails - 5), 15 * 60_000);
}

/** گزینه‌های «قفل خودکار بعد از» به ثانیه */
export const AUTO_LOCK_OPTIONS: [string, string][] = [['0', 'فوری'], ['30', '۳۰ ثانیه'], ['60', '۱ دقیقه'], ['300', '۵ دقیقه']];
export const DEFAULT_AUTO_LOCK = 60;

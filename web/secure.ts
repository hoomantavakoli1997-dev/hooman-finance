/**
 * رمزنگاری اطلاعات روی گوشی (AES-256-GCM با WebCrypto).
 * کلید ۲۵۶ بیتی را بخش بومی در Android Keystore نگه می‌دارد و هنگام اجرا به صفحه می‌دهد؛
 * متن رمزشده به‌شکل پاکت {enc:1, iv, data} در پایگاه داده‌ی گوشی ذخیره می‌شود.
 */
export interface Envelope { enc: 1; iv: string; data: string }

export function isEnvelope(x: unknown): x is Envelope {
  const e = x as Envelope | null;
  return !!e && typeof e === 'object' && e.enc === 1 && typeof e.iv === 'string' && typeof e.data === 'string';
}

/** اگر متن یک پاکت رمزشده باشد برمی‌گرداند، وگرنه null */
export function parseEnvelope(raw: string | null | undefined): Envelope | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return isEnvelope(o) ? o : null;
  } catch {
    return null;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function toB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function validKeyHex(k: unknown): k is string {
  return typeof k === 'string' && /^[0-9a-f]{64}$/.test(k);
}

export function secureAvailable(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof atob === 'function';
}

export async function importKey(hex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', hexToBytes(hex) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptText(key: CryptoKey, text: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { enc: 1, iv: toB64(iv), data: toB64(new Uint8Array(buf)) };
}

/** اگر کلید اشتباه یا داده دست‌خورده باشد خطا می‌دهد (GCM صحت را هم می‌سنجد) */
export async function decryptText(key: CryptoKey, env: Envelope): Promise<string> {
  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) as BufferSource }, key, fromB64(env.data) as BufferSource);
  return new TextDecoder().decode(buf);
}

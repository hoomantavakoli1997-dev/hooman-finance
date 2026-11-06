/**
 * تبدیل تاریخ میلادی ⇄ شمسی (الگوریتم حسابی چرخه‌ی ۳۳ ساله).
 * تاریخ‌ها در دیتابیس همیشه میلادی ISO (YYYY-MM-DD) ذخیره می‌شوند و فقط در نمایش شمسی‌اند.
 */

export interface YMD {
  y: number;
  m: number;
  d: number;
}

const G_D_M = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const div = (a: number, b: number) => Math.floor(a / b);

export function gregorianToJalali(gy: number, gm: number, gd: number): YMD {
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 + 365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) + gd + G_D_M[gm - 1];
  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  let jm: number;
  let jd: number;
  if (days < 186) {
    jm = 1 + div(days, 31);
    jd = 1 + (days % 31);
  } else {
    jm = 7 + div(days - 186, 30);
    jd = 1 + ((days - 186) % 30);
  }
  return { y: jy, m: jm, d: jd };
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): YMD {
  jy += 1595;
  let days =
    -355668 + 365 * jy + div(jy, 33) * 8 + div((jy % 33) + 3, 4) + jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * div(days, 146097);
  days %= 146097;
  if (days > 36524) {
    days -= 1;
    gy += 100 * div(days, 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    gy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const sal = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  while (gm < 13 && gd > sal[gm]) {
    gd -= sal[gm];
    gm += 1;
  }
  return { y: gy, m: gm, d: gd };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function isoToJalali(iso: string): YMD | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return gregorianToJalali(+m[1], +m[2], +m[3]);
}

/** تاریخ شمسی → ISO میلادی؛ اگر تاریخ وجود نداشته باشد (مثلاً ۳۱ مهر) null */
export function jalaliToIso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1300 || y > 1500 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const g = jalaliToGregorian(y, m, d);
  const back = gregorianToJalali(g.y, g.m, g.d);
  if (back.y !== y || back.m !== m || back.d !== d) return null;
  return `${pad(g.y, 4)}-${pad(g.m)}-${pad(g.d)}`;
}

export function todayIso(now: Date = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/** ۱۴۰۵/۰۸/۱۲ با ارقام انگلیسی (تبدیل به ارقام فارسی در لایه‌ی نمایش) */
export function formatJalali(iso: string): string {
  const j = isoToJalali(iso);
  return j ? `${pad(j.y, 4)}/${pad(j.m)}/${pad(j.d)}` : iso;
}

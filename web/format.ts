/** قالب‌بندی خالص (بدون وابستگی به وضعیت برنامه): ارقام فارسی، فرار از HTML، جداکننده‌ی هزارگان */
import { Decimal } from '../src/core/decimal';

const FA = '۰۱۲۳۴۵۶۷۸۹';
export const toFa = (s: string) => s.replace(/\d/g, (d) => FA[Number(d)]);
export const toEn = (s: string) =>
  s
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[٬,،\s‌‏‎]/g, '')
    .replace(/٫/g, '.');
export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
export const group = (i: string) => i.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');

export function fmtNum(d: Decimal, places = 0): string {
  const s = d.toFixed(places);
  const neg = s[0] === '-';
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
  const fr = f.replace(/0+$/, '');
  return (neg ? '−' : '') + toFa(group(i)) + (fr ? '٫' + toFa(fr) : '');
}

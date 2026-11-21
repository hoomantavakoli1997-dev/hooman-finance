import test from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from './decimal';
import { esc, fmtNum, toEn, toFa } from '../../web/format';

test('ارقام فارسی و برگشت به لاتین', () => {
  assert.equal(toFa('۱2۳4'), '۱۲۳۴');
  assert.equal(toEn('۱٬۲۳۴٫۵'), '1234.5');
  assert.equal(toEn('١٢٣'), '123');
});
test('فرار از HTML', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});
test('قالب‌بندی عدد: هزارگان، اعشار و منفی', () => {
  assert.equal(fmtNum(Decimal.of('1234567')), '۱٬۲۳۴٬۵۶۷');
  assert.equal(fmtNum(Decimal.of('-1234.50'), 2), '−۱٬۲۳۴٫۵');
  assert.equal(fmtNum(Decimal.of('0.000'), 3), '۰');
});

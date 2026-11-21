import test from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from './decimal';
import { computeLoan, impliedAnnualRate, validateLoan } from './loan';

const D = (s: string) => Decimal.of(s);

test('کاهشی: ۱۰۰ میلیون، ۱۸٪، ۱۲ ماه ⇒ قسط ≈ ۹٬۱۶۷٬۹۹۹', () => {
  const r = computeLoan(D('100000000'), D('18'), 12, 'annuity')!;
  assert.equal(r.payment.toString(), '9167999');
  assert.equal(r.rows.length, 12);
  assert.equal(r.rows[11].balance.toString(), '0');
  // مجموع بازپرداخت اصل برابر اصل وام
  assert.equal(r.rows.reduce((s, x) => s.plus(x.principal), D('0')).toString(), '100000000');
  assert.equal(r.rows[0].interest.toString(), '1500000');
});

test('کاهشی بدون سود: تقسیم مساوی', () => {
  const r = computeLoan(D('1200'), D('0'), 12, 'annuity')!;
  assert.equal(r.payment.toString(), '100');
  assert.equal(r.totalInterest.toString(), '0');
});

test('ثابت: ۱۰۰ میلیون، ۲۳٪، ۱۲ ماه ⇒ سود کل ۲۳ میلیون', () => {
  const r = computeLoan(D('100000000'), D('23'), 12, 'flat')!;
  assert.equal(r.totalInterest.toString(), '23000000');
  assert.equal(r.payment.toString(), '10250000');
  assert.equal(r.rows[11].balance.toString(), '0');
});

test('قسط آخر باقی‌مانده‌ی گرد را می‌گیرد و مانده صفر می‌شود', () => {
  const r = computeLoan(D('1000000'), D('17.5'), 7, 'annuity')!;
  assert.equal(r.rows[6].balance.toString(), '0');
  assert.ok(r.rows.every((x) => x.balance.gte(0)));
});

test('تاریخ اقساط ماهانه شمسی', () => {
  const r = computeLoan(D('1200'), D('0'), 3, 'annuity', '2026-03-21')!; // ۱ فروردین ۱۴۰۵
  assert.deepEqual(r.rows.map((x) => x.date), ['2026-03-21', '2026-04-21', '2026-05-22']);
});

test('اعتبارسنجی', () => {
  assert.notEqual(validateLoan(D('0'), D('10'), 12), null);
  assert.notEqual(validateLoan(D('100'), D('-1'), 12), null);
  assert.notEqual(validateLoan(D('100'), D('10'), 0), null);
  assert.notEqual(validateLoan(D('100'), D('10'), 1000), null);
  assert.equal(computeLoan(D('100'), D('10'), 0, 'flat'), null);
});

test('نرخ مؤثر از روی قسط، نرخ اولیه را برمی‌گرداند', () => {
  const r = computeLoan(D('100000000'), D('18'), 12, 'annuity')!;
  const rate = impliedAnnualRate(100000000, r.payment.toNumber(), 12)!;
  assert.ok(Math.abs(rate - 18) < 0.01, String(rate));
  assert.equal(impliedAnnualRate(1000, 50, 12), null); // جمع اقساط کمتر از اصل
  assert.equal(impliedAnnualRate(1200, 100, 12), 0);
});

test('وام ۳۶۰ ماهه محاسبه می‌شود و مانده صفر است', () => {
  const r = computeLoan(D('5000000000'), D('20'), 360, 'annuity')!;
  assert.equal(r.rows[359].balance.toString(), '0');
});

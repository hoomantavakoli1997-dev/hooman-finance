import test from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from './decimal';
import { familyReportText, FamilyInput } from './familyreport';

const base = (opts: FamilyInput['opts']): FamilyInput => ({
  dateLabel: '۱۴۰۵/۰۸/۳۰', worth: Decimal.of('123456789'),
  alloc: { total: Decimal.of('100'), unpriced: [], slices: [{ id: 'gold', label: 'طلا و فلزات', value: Decimal.of('60'), pct: 60 }, { id: 'cash', label: 'نقد', value: Decimal.of('40'), pct: 40 }] },
  items: [
    { kind: 'installment-out', label: 'وام بلو بانک', due: '2026-11-25', amount: Decimal.of('20000000') },
    { kind: 'cheque-in', label: 'چک علی رضایی', due: '2026-11-10', amount: Decimal.of('5000000') },
    { kind: 'installment-out', label: 'دور', due: '2027-05-01', amount: Decimal.of('1') },
  ],
  today: '2026-11-21', fmtMoney: (d) => `M${d.toString()}`, fmtDate: (s) => `D${s}`, opts,
});

test('پیش‌فرض امن: بدون مبلغ و بدون نام', () => {
  const t = familyReportText(base({ amounts: false, names: false, commitments: true }));
  assert.ok(!t.includes('M'), 'مبلغی نباید باشد');
  assert.ok(!t.includes('بلو') && !t.includes('رضایی'), 'نامی نباید باشد');
  assert.ok(t.includes('طلا و فلزات: ۶۰٫۰'.replace('۶۰٫۰', '60٫0')));
  assert.ok(t.includes('قسطِ پرداختی') && t.includes('چکِ دریافتی'));
  assert.ok(t.includes('(گذشته)'), 'چک گذشته مشخص شود');
  assert.ok(!t.includes('D2027-05-01'), 'خارج از افق نیاید');
});

test('با مبلغ و نام روشن', () => {
  const t = familyReportText(base({ amounts: true, names: true, commitments: true }));
  assert.ok(t.includes('M123456789') && t.includes('وام بلو بانک') && t.includes('M20000000'));
});

test('بدون تعهدات', () => {
  const t = familyReportText(base({ amounts: false, names: false, commitments: false }));
  assert.ok(!t.includes('تعهدات'));
});

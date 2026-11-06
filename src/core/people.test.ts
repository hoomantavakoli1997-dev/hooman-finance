import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from './decimal';
import {
  addJalaliMonths, cashEffect, computeDebt, computePeople, computePerson, Debt, DebtPayment,
  netWorth, PeopleData, validatePeople,
} from './people';
import { jalaliToIso, isoToJalali } from './jalali';

const D = (v: string) => Decimal.parse(v);
const J = (y: number, m: number, d: number) => jalaliToIso(y, m, d)!;
const TODAY = J(1405, 8, 14);

const empty = (): PeopleData => ({ people: [], debts: [], payments: [] });

/** مثال کاربر: وام بلو بانک ۱۵ میلیون، ۳ قسط ۲ میلیونی پرداخت‌شده، ۹ میلیون مانده */
function blu(): PeopleData {
  const debt: Debt = {
    id: 'd1', personId: 'p1', direction: 'borrowed', title: 'وام بلو بانک',
    amount: '150000000', date: J(1405, 4, 1),
    plan: { count: 8, installment: '20000000', firstDate: J(1405, 5, 1), everyMonths: 1 },
  };
  const pay = (id: string, d: string): DebtPayment => ({ id, debtId: 'd1', date: d, amount: '20000000' });
  return {
    people: [{ id: 'p1', name: 'بلو بانک' }],
    debts: [debt],
    payments: [pay('a', J(1405, 5, 1)), pay('b', J(1405, 6, 1)), pay('c', J(1405, 7, 1))],
  };
}

test('وام بانکی: ۱۵ میلیون، ۳ قسط ۲ میلیونی پرداخت‌شده → ۹ میلیون مانده', () => {
  const data = blu();
  const s = computeDebt(data.debts[0], data.payments, TODAY);
  assert.ok(s.paid.eq(D('60000000')));
  assert.ok(s.remaining.eq(D('90000000')));
  assert.equal(s.settled, false);
  assert.deepEqual(s.payments.map((p) => p.remainingAfter.toString()), ['130000000', '110000000', '90000000']);
  // اقساط ۱ تا ۳ پرداخت‌شده، قسط ۴ (۱۴۰۵/۰۸/۰۱) سررسید گذشته
  assert.deepEqual(s.schedule.slice(0, 4).map((r) => r.status), ['paid', 'paid', 'paid', 'unpaid']);
  assert.equal(s.schedule[3].overdue, true);
  assert.equal(s.schedule[4].overdue, false); // ۱۴۰۵/۰۹/۰۱ هنوز نرسیده
  assert.equal(s.nextDue?.index, 4);
  assert.equal(s.overdueCount, 1);
  assert.equal(s.schedule.length, 8);
  // قسط آخر باقی‌مانده را می‌گیرد: ۱۵۰ − ۷×۲۰ = ۱۰ میلیون ریال (۱ میلیون تومان)
  assert.ok(s.schedule[7].amount.eq(D('10000000')));
});

test('قرض به هومن: ۱۰ میلیون، ۵ قسط ۱ میلیونی به تفکیک تاریخ', () => {
  const data: PeopleData = {
    people: [{ id: 'h', name: 'هومن' }],
    debts: [{ id: 'd', personId: 'h', direction: 'lent', title: 'قرض', amount: '100000000', date: J(1405, 1, 10) }],
    payments: [2, 3, 4, 5, 6].map((m, i) => ({ id: `p${i}`, debtId: 'd', date: J(1405, m, 10), amount: '10000000' })),
  };
  const ps = computePerson(data.people[0], data, TODAY);
  assert.ok(ps.receivable.eq(D('50000000')));
  assert.ok(ps.payable.isZero());
  assert.ok(ps.net.eq(D('50000000'))); // او ۵ میلیون تومان به من بدهکار است
  assert.deepEqual(ps.debts[0].payments.map((p) => p.remainingAfter.toString()),
    ['90000000', '80000000', '70000000', '60000000', '50000000']);
});

test('پرداخت کامل: تسویه می‌شود و از طلب کم می‌شود', () => {
  const data = blu();
  data.debts[0] = { ...data.debts[0], amount: '60000000', plan: undefined };
  const s = computeDebt(data.debts[0], data.payments, TODAY);
  assert.equal(s.settled, true);
  assert.ok(computePeople(data, TODAY).payable.isZero());
});

test('اقساط: ماه شمسی، روز ۳۱ و پایان ماه', () => {
  assert.equal(addJalaliMonths(J(1405, 6, 31), 1), J(1405, 7, 30)); // مهر ۳۰ روز
  assert.equal(addJalaliMonths(J(1405, 11, 30), 1), J(1405, 12, 29)); // اسفند ۱۴۰۵ ۲۹ روزه
  assert.deepEqual(isoToJalali(addJalaliMonths(J(1405, 10, 15), 3)), { y: 1406, m: 1, d: 15 });
  assert.equal(addJalaliMonths(J(1405, 1, 1), 0), J(1405, 1, 1));
});

test('پرداخت جزئی: قسط نیمه‌پرداخت‌شده', () => {
  const data = blu();
  data.payments = [{ id: 'a', debtId: 'd1', date: J(1405, 5, 1), amount: '30000000' }];
  const s = computeDebt(data.debts[0], data.payments, TODAY);
  assert.deepEqual(s.schedule.slice(0, 3).map((r) => r.status), ['paid', 'partial', 'unpaid']);
  assert.ok(s.schedule[1].paidPart.eq(D('10000000')));
});

test('اعتبارسنجی: پرداخت بیشتر از مانده، قبل از وام، اقساط بیش از مبلغ', () => {
  const data = blu();
  assert.deepEqual(validatePeople(data), []);
  const over = { ...data, payments: [...data.payments, { id: 'x', debtId: 'd1', date: J(1405, 8, 1), amount: '999999999999' }] };
  assert.ok(validatePeople(over).some((i) => i.code === 'OVERPAY'));
  const early = { ...data, payments: [{ id: 'y', debtId: 'd1', date: J(1405, 1, 1), amount: '1000' }] };
  assert.ok(validatePeople(early).some((i) => i.code === 'BEFORE_START'));
  const plan = { ...data, debts: [{ ...data.debts[0], plan: { count: 10, installment: '20000000', firstDate: J(1405, 5, 1), everyMonths: 1 } }] };
  assert.ok(validatePeople(plan).some((i) => i.code === 'BAD_PLAN')); // ۱۰×۲۰ > ۱۵۰
  assert.ok(validatePeople({ ...data, payments: [{ id: 'z', debtId: 'nope', date: J(1405, 8, 1), amount: '1' }] }).length > 0);
});

test('پرداخت حذف‌شده محاسبه نمی‌شود', () => {
  const data = blu();
  data.payments[2] = { ...data.payments[2], deletedAt: 'x' };
  assert.ok(computeDebt(data.debts[0], data.payments, TODAY).remaining.eq(D('110000000')));
});

test('نقد: فقط وقتی «fromCash» روشن است اثر می‌گذارد', () => {
  const data = blu();
  assert.ok(cashEffect(data).isZero()); // پیش‌فرض: جدا
  data.debts[0] = { ...data.debts[0], fromCash: true };           // وام گرفته‌ام: +۱۵۰
  data.payments[0] = { ...data.payments[0], fromCash: true };     // قسط داده‌ام: −۲۰
  assert.ok(cashEffect(data).eq(D('130000000')));
  const lent: PeopleData = {
    people: [{ id: 'h', name: 'هومن' }],
    debts: [{ id: 'd', personId: 'h', direction: 'lent', title: 'قرض', amount: '100000000', date: J(1405, 1, 10), fromCash: true }],
    payments: [{ id: 'p', debtId: 'd', date: J(1405, 2, 10), amount: '10000000', fromCash: true }],
  };
  assert.ok(cashEffect(lent).eq(D('-90000000'))); // −۱۰۰ + ۱۰
});

test('سرمایه خالص = نقد + دارایی + طلب − بدهی (مثال علی و رضا)', () => {
  const data: PeopleData = {
    people: [{ id: 'a', name: 'علی' }, { id: 'r', name: 'رضا' }],
    debts: [
      { id: 'd1', personId: 'a', direction: 'lent', title: 'قرض', amount: '50000000', date: J(1405, 1, 1) },
      { id: 'd2', personId: 'r', direction: 'borrowed', title: 'قرض', amount: '20000000', date: J(1405, 1, 1) },
    ],
    payments: [],
  };
  const sum = computePeople(data, TODAY);
  assert.ok(netWorth(D('100000000'), D('260000000'), sum).eq(D('390000000')));
  data.payments.push({ id: 'p', debtId: 'd1', date: J(1405, 2, 1), amount: '10000000' });
  const after = computePeople(data, TODAY);
  assert.ok(after.receivable.eq(D('40000000')));
  // علی ۱ میلیون تومان داد و آن را نقد واریز کردم: جمع سرمایه ثابت می‌ماند
  assert.ok(netWorth(D('110000000'), D('260000000'), after).eq(D('390000000')));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from './decimal';
import { Debt, DebtPayment } from './people';
import {
  DEFAULT_REMINDER_SETTINGS, PriceReminder, activeEvents, addDaysIso, dateEvents, daysBetween, installmentEvents,
  priceHit, scheduleNotes, validateReminder,
} from './reminders';

const debt = (over: Partial<Debt> = {}): Debt => ({
  id: 'd1', personId: 'p1', direction: 'borrowed', title: 'وام بانک', amount: '300000000', date: '2026-01-01',
  plan: { count: 3, installment: '100000000', firstDate: '2026-11-20', everyMonths: 1 }, ...over,
});
const name = () => 'بانک';

test('جمع و تفریق روز و فاصله', () => {
  assert.equal(addDaysIso('2026-11-30', 1), '2026-12-01');
  assert.equal(addDaysIso('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-11-14', '2026-11-20'), 6);
});

test('اقساط پرداخت‌نشده یادآور می‌شوند و قسط پرداخت‌شده نه', () => {
  const pays: DebtPayment[] = [{ id: 'q1', debtId: 'd1', date: '2026-11-20', amount: '100000000' }];
  const ev = installmentEvents([debt()], pays, name, DEFAULT_REMINDER_SETTINGS, '2026-11-25');
  assert.equal(ev.length, 2); // قسط ۲ و ۳؛ قسط ۱ پرداخت شده
  assert.equal(ev[0].id, 'inst:d1:2');
  assert.equal(ev[0].amount, '100000000');
  assert.equal(ev[0].remindOn, addDaysIso(ev[0].dueDate, -1));
});

test('قسط نیمه‌پرداخت فقط مانده را نشان می‌دهد', () => {
  const pays: DebtPayment[] = [{ id: 'q1', debtId: 'd1', date: '2026-11-20', amount: '40000000' }];
  const ev = installmentEvents([debt()], pays, name, DEFAULT_REMINDER_SETTINGS, '2026-11-21');
  assert.equal(ev[0].amount, '60000000');
});

test('خاموش بودن یادآوری اقساط و وام حذف‌شده', () => {
  assert.equal(installmentEvents([debt()], [], name, { ...DEFAULT_REMINDER_SETTINGS, installments: false }, '2026-11-14').length, 0);
  assert.equal(installmentEvents([debt({ deletedAt: '2026-11-01' })], [], name, DEFAULT_REMINDER_SETTINGS, '2026-11-14').length, 0);
});

test('طلب من: عنوان دریافت قسط', () => {
  const ev = installmentEvents([debt({ direction: 'lent' })], [], name, DEFAULT_REMINDER_SETTINGS, '2026-11-14');
  assert.match(ev[0].title, /دریافت/);
});

test('افق ۶۰ روز', () => {
  const ev = installmentEvents([debt()], [], name, DEFAULT_REMINDER_SETTINGS, '2026-11-14', 10);
  assert.equal(ev.length, 1);
});

test('فعال شدن یادآور از روز یادآوری و عقب‌افتاده‌ها', () => {
  const ev = dateEvents([{ id: 'a', kind: 'date', title: 'چک', date: '2026-11-20', leadDays: 3 }], '2026-11-14');
  assert.equal(activeEvents(ev, '2026-11-16').length, 0);
  assert.equal(activeEvents(ev, '2026-11-17').length, 1);
  assert.equal(activeEvents(ev, '2026-12-30').length, 1);
});

test('انجام‌شده یادآور نمی‌شود', () => {
  assert.equal(dateEvents([{ id: 'a', kind: 'date', title: 'x', date: '2026-11-20', leadDays: 0, done: true }], '2026-11-14').length, 0);
});

test('زمان‌بندی اعلان: فقط آینده و به ترتیب', () => {
  const ev = dateEvents([
    { id: 'a', kind: 'date', title: 'گذشته', date: '2020-01-01', leadDays: 0 },
    { id: 'b', kind: 'date', title: 'دوم', date: '2099-02-01', leadDays: 0 },
    { id: 'c', kind: 'date', title: 'اول', date: '2099-01-01', leadDays: 1 },
  ], '2026-11-14');
  const n = scheduleNotes(ev, 9, Date.UTC(2026, 10, 14));
  assert.deepEqual(n.map((x) => x.title), ['اول', 'دوم']);
  assert.equal(new Date(n[0].at).getHours(), 9);
  assert.equal(new Date(n[0].at).getDate(), 31);
});

test('هشدار قیمت: بالاتر و پایین‌تر، و قیمت نامعتبر', () => {
  const r = (cond: 'above' | 'below'): PriceReminder => ({ id: 'p', kind: 'price', assetId: 'x', side: 'sell', cond, target: '30000' });
  assert.equal(priceHit(r('above'), Decimal.of('30000')), true);
  assert.equal(priceHit(r('above'), Decimal.of('29999')), false);
  assert.equal(priceHit(r('below'), Decimal.of('30000')), true);
  assert.equal(priceHit(r('below'), Decimal.of('30001')), false);
  assert.equal(priceHit(r('below'), Decimal.of('0')), false);
});

test('اعتبارسنجی', () => {
  assert.ok(validateReminder({ id: 'a', kind: 'date', title: ' ', date: '2026-11-20', leadDays: 0 }));
  assert.ok(validateReminder({ id: 'a', kind: 'date', title: 'x', date: '2026-13-45', leadDays: 0 }));
  assert.equal(validateReminder({ id: 'a', kind: 'date', title: 'x', date: '2026-11-20', leadDays: 1 }), null);
  assert.ok(validateReminder({ id: 'p', kind: 'price', assetId: 'x', side: 'buy', cond: 'below', target: '0' }));
  assert.equal(validateReminder({ id: 'p', kind: 'price', assetId: 'x', side: 'buy', cond: 'below', target: '100' }), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { chequeDue, chequeOutstanding, sortCheques, validateCheque, type Cheque } from './checks';

const base = {
  direction: 'received' as const, number: '123456', bank: 'ملی', accountHolder: 'علی',
  amount: '250000000', issueDate: '2026-11-01', dueDate: '2026-11-20',
  status: 'pending' as const, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z',
};
const cheque = (id: string, patch: Partial<Cheque> = {}): Cheque => ({ id, ...base, ...patch });

test('valid cheque accepted; invalid fields rejected', () => {
  assert.equal(validateCheque(base).valid, true);
  assert.equal(validateCheque({ ...base, amount: '0' }).valid, false);
  assert.equal(validateCheque({ ...base, dueDate: '2026-10-01' }).valid, false);
  assert.equal(validateCheque({ ...base, number: ' ' }).valid, false);
});
test('due state is based on ISO dates and settled states are closed', () => {
  assert.equal(chequeDue(cheque('a'), '2026-11-21'), 'overdue');
  assert.equal(chequeDue(cheque('a'), '2026-11-20'), 'today');
  assert.equal(chequeDue(cheque('a'), '2026-11-19'), 'upcoming');
  assert.equal(chequeDue(cheque('a', { status: 'cleared' }), '2026-11-21'), 'closed');
});
test('only pending, deposited and bounced cheques remain outstanding', () => {
  assert.equal(chequeOutstanding(cheque('a')), true);
  assert.equal(chequeOutstanding(cheque('b', { status: 'bounced' })), true);
  assert.equal(chequeOutstanding(cheque('c', { status: 'cleared' })), false);
});
test('sort places attention-needed cheques first, then due date', () => {
  const sorted = sortCheques([
    cheque('later', { dueDate: '2026-11-25' }),
    cheque('cleared', { status: 'cleared' }),
    cheque('bounced', { status: 'bounced' }),
  ]);
  assert.deepEqual(sorted.map(x => x.id), ['bounced', 'later', 'cleared']);
});

import { chequeTotals, chequeCashDraft, duplicateCheque } from './checks';
import { Decimal as D } from './decimal';

const mk = (over: Partial<Cheque>): Cheque => ({
  id: 'c', direction: 'received', number: '123', bank: 'ملی', accountHolder: 'x', amount: '1000', issueDate: '2026-01-01',
  dueDate: '2026-02-01', status: 'pending', createdAt: 'a', updatedAt: 'a', ...over,
});

test('جمع چک‌های باز برای سرمایه‌ی خالص', () => {
  const t = chequeTotals([
    mk({ amount: '100' }), mk({ id: '2', status: 'deposited', amount: '200' }), mk({ id: '3', status: 'bounced', amount: '400' }),
    mk({ id: '4', status: 'cleared', amount: '800' }), mk({ id: '5', status: 'cancelled', amount: '1600' }),
    mk({ id: '6', direction: 'issued', amount: '10' }), mk({ id: '7', direction: 'issued', status: 'bounced', amount: '20' }),
    mk({ id: '8', direction: 'issued', status: 'cleared', amount: '40' }),
  ]);
  assert.equal(t.receivable.toString(), '300'); // برگشتی دریافتی حساب نمی‌شود
  assert.equal(t.payable.toString(), '30'); // برگشتی پرداختی هنوز بدهی است
  assert.ok(t.receivable instanceof D);
});

test('معامله‌ی نقدی وصول چک', () => {
  const r = chequeCashDraft(mk({ amount: '5000' }), '2026-02-01');
  assert.equal(r.type, 'deposit'); assert.equal(r.quantity, '5000'); assert.equal(r.unitPrice, '1'); assert.equal(r.assetId, 'cash');
  assert.equal(chequeCashDraft(mk({ direction: 'issued' }), '2026-02-01').type, 'withdraw');
});

test('چک تکراری', () => {
  const list = [mk({ number: '12 34', bank: 'ملی' })];
  assert.equal(duplicateCheque(list, { number: '1234', bank: 'ملی', direction: 'received' }), true);
  assert.equal(duplicateCheque(list, { number: '1234', bank: 'ملی', direction: 'issued' }), false);
  assert.equal(duplicateCheque(list, { number: '1234', bank: 'ملت', direction: 'received' }), false);
  assert.equal(duplicateCheque(list, { number: '1234', bank: 'ملی', direction: 'received' }, 'c'), false);
  assert.equal(duplicateCheque([mk({ status: 'cancelled' })], { number: '123', bank: 'ملی', direction: 'received' }), false);
});

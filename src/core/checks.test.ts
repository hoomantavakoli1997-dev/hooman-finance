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

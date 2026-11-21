import test from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from './decimal';
import { addTx, computeCash } from './engine';
import { accrualInterest, incomeDraft, incomeTotals, incomeTxs, validateIncome } from './income';

const D = (s: string) => Decimal.of(s);

test('سود روزشمار: ۱۰۰ میلیون با ۲۳٪ سالانه برای ۳۰ روز', () => {
  // ۱۰۰٬۰۰۰٬۰۰۰ × ۰٫۲۳ × ۳۰ ÷ ۳۶۵ = ۱٬۸۹۰٬۴۱۱ (گرد)
  assert.equal(accrualInterest(D('100000000'), D('23'), '2026-01-01', '2026-01-31')!.toString(), '1890411');
});

test('سود روزشمار: ورودی نامعتبر null می‌دهد', () => {
  assert.equal(accrualInterest(D('0'), D('23'), '2026-01-01', '2026-01-31'), null);
  assert.equal(accrualInterest(D('100'), D('23'), '2026-02-01', '2026-01-31'), null);
  assert.equal(accrualInterest(D('100'), D('-1'), '2026-01-01', '2026-01-31'), null);
  assert.equal(accrualInterest(D('100'), D('23'), 'x', '2026-01-31'), null);
});

test('درآمد به نقد اضافه می‌شود و در جمع درآمد می‌آید', () => {
  let txs = addTx([], { assetId: 'cash', type: 'deposit', date: '2026-01-01', quantity: '1000', unitPrice: '1', fee: '0' }).txs;
  txs = addTx(txs, incomeDraft('dividend', '2026-02-01', D('500'), 'فولاد')).txs;
  txs = addTx(txs, incomeDraft('deposit', '2026-02-15', D('200'), 'بانک')).txs;
  txs = addTx(txs, incomeDraft('accrual', '2026-03-01', D('300'), '')).txs;
  assert.equal(computeCash(txs).balance.toString(), '2000');
  const t = incomeTotals(txs, '2026-02-01', '2026-02-28');
  assert.equal(t.dividend.toString(), '500');
  assert.equal(t.deposit.toString(), '200');
  assert.equal(t.accrual.toString(), '0');
  assert.equal(t.total.toString(), '700');
  assert.equal(incomeTxs(txs).length, 3);
  assert.equal(incomeTxs(txs)[0].income, 'accrual'); // جدیدترین اول
});

test('آورده‌ی نقد عادی درآمد حساب نمی‌شود', () => {
  const txs = addTx([], { assetId: 'cash', type: 'deposit', date: '2026-01-01', quantity: '1000', unitPrice: '1', fee: '0' }).txs;
  assert.equal(incomeTotals(txs, '2026-01-01', '2026-12-31').total.toString(), '0');
});

test('اعتبارسنجی', () => {
  assert.equal(validateIncome('2026-01-01', D('1')), null);
  assert.notEqual(validateIncome('2026-13-01', D('1')), null);
  assert.notEqual(validateIncome('2026-01-01', D('0')), null);
});

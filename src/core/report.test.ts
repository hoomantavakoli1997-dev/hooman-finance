import test from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from './decimal';
import { addTx } from './engine';
import { incomeDraft } from './income';
import { csvCell, monthRange, monthReport, reportCsv, shiftMonth, txCsv } from './report';
import { Asset, Tx } from './types';

const gold: Asset = { id: 'gold', name: 'طلا ۱۸ عیار', unit: 'گرم', kind: 'metal', decimals: 3 };
const D = (s: string) => Decimal.of(s);
function build(): Tx[] {
  let txs: Tx[] = [];
  const add = (d: Parameters<typeof addTx>[1]) => { txs = addTx(txs, d).txs; };
  add({ assetId: 'cash', type: 'deposit', date: '2026-10-01', quantity: '5000', unitPrice: '1', fee: '0' });
  add({ assetId: 'gold', type: 'buy', date: '2026-10-05', quantity: '2', unitPrice: '1000', fee: '10', note: '=HYPERLINK("x")' });
  add({ assetId: 'gold', type: 'sell', date: '2026-10-20', quantity: '1', unitPrice: '1300', fee: '5' });
  add(incomeDraft('dividend', '2026-10-25', D('70'), 'فولاد'));
  add({ assetId: 'cash', type: 'withdraw', date: '2026-10-26', quantity: '100', unitPrice: '1', fee: '0' });
  add({ assetId: 'gold', type: 'buy', date: '2026-11-05', quantity: '1', unitPrice: '1100', fee: '0' });
  return txs;
}

test('بازه‌ی ماه شمسی', () => {
  assert.deepEqual(monthRange(1405, 7), { from: '2026-09-23', to: '2026-10-22' });
  assert.deepEqual(monthRange(1405, 12), { from: '2027-02-20', to: '2027-03-20' });
  assert.equal(monthRange(1405, 13), null);
});

test('جابه‌جایی ماه', () => {
  assert.deepEqual(shiftMonth(1405, 1, -1), { y: 1404, m: 12 });
  assert.deepEqual(shiftMonth(1405, 12, 1), { y: 1406, m: 1 });
});

test('گزارش ماه: خرید، فروش، سود فروش، درآمد و نقد', () => {
  const r = monthReport([gold], build(), '2026-10-01', '2026-10-31');
  assert.equal(r.bought.toString(), '2010');   // ۲×۱۰۰۰ + ۱۰
  assert.equal(r.sold.toString(), '1295');     // ۱۳۰۰ − ۵
  assert.equal(r.fees.toString(), '15');
  assert.equal(r.realized.toString(), '290');  // ۱۲۹۵ − نصفِ ۲۰۱۰ (۱۰۰۵)
  assert.equal(r.income.dividend.toString(), '70');
  assert.equal(r.cashIn.toString(), '5000');   // سود سهام واریز عادی نیست
  assert.equal(r.cashOut.toString(), '100');
  assert.equal(r.txCount, 5);
  assert.equal(r.worthStart, null);
});

test('گزارش ماه دیگر معاملات این ماه را نمی‌شمارد', () => {
  const r = monthReport([gold], build(), '2026-11-01', '2026-11-30');
  assert.equal(r.txCount, 1);
  assert.equal(r.bought.toString(), '1100');
  assert.equal(r.income.total.toString(), '0');
});

test('csvCell: نقل‌قول، ویرگول و جلوگیری از فرمول', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('-5', false), '-5');
  assert.equal(csvCell('+98'), "'+98");
});

test('خروجی CSV: BOM، سرستون، یادداشت فرمول‌نما بی‌اثر', () => {
  const csv = txCsv([gold], build(), '2026-10-01', '2026-10-31');
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 6); // سرستون + ۵ تراکنش
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(lines[1].startsWith('1405/07/09,2026-10-01,نقد,واریز'));
  assert.ok(csv.includes('سود سهام'));
});

test('CSV خلاصه‌ی ماه', () => {
  const r = monthReport([gold], build(), '2026-10-01', '2026-10-31');
  const csv = reportCsv('مهر ۱۴۰۵', r);
  assert.ok(csv.includes('سود یا زیان فروش‌ها (ریال),290'));
});

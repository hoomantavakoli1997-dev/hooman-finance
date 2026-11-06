import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatJalali, gregorianToJalali, isoToJalali, jalaliToGregorian, jalaliToIso,
} from './jalali';

test('تاریخ‌های مرجع (نوروز و امروز)', () => {
  assert.deepEqual(gregorianToJalali(2026, 3, 21), { y: 1405, m: 1, d: 1 });
  assert.deepEqual(gregorianToJalali(2025, 3, 21), { y: 1404, m: 1, d: 1 });
  assert.deepEqual(gregorianToJalali(2024, 3, 20), { y: 1403, m: 1, d: 1 });
  assert.deepEqual(gregorianToJalali(2026, 11, 3), { y: 1405, m: 8, d: 12 });
  assert.deepEqual(gregorianToJalali(2026, 10, 23), { y: 1405, m: 8, d: 1 });
});

test('سال کبیسه‌ی شمسی: ۱۴۰۳ اسفند ۳۰ روز دارد و ۱۴۰۴ نه', () => {
  assert.equal(jalaliToIso(1403, 12, 30), '2025-03-20');
  assert.equal(jalaliToIso(1404, 12, 30), null);
  assert.equal(jalaliToIso(1404, 12, 29), '2026-03-20');
});

test('تاریخ‌های ناموجود رد می‌شوند', () => {
  assert.equal(jalaliToIso(1405, 7, 31), null); // مهر ۳۰ روز است
  assert.equal(jalaliToIso(1405, 6, 31), '2026-09-22'); // شهریور ۳۱ روز است
  assert.equal(jalaliToIso(1405, 13, 1), null);
  assert.equal(jalaliToIso(1405, 0, 1), null);
  assert.equal(jalaliToIso(1405, 1, 32), null);
  assert.equal(jalaliToIso(1405.5, 1, 1), null);
});

test('رفت‌وبرگشت برای هر روز بین ۲۰۰۰ تا ۲۰۵۰ میلادی', () => {
  const d = new Date(Date.UTC(2000, 0, 1));
  const end = Date.UTC(2050, 0, 1);
  let prev: { y: number; m: number; d: number } | null = null;
  let count = 0;
  while (d.getTime() < end) {
    const gy = d.getUTCFullYear();
    const gm = d.getUTCMonth() + 1;
    const gd = d.getUTCDate();
    const j = gregorianToJalali(gy, gm, gd);
    const g = jalaliToGregorian(j.y, j.m, j.d);
    assert.deepEqual(g, { y: gy, m: gm, d: gd });
    // روزها پشت‌سرهم و بدون پرش پیش می‌روند
    if (prev) {
      const nextDay = prev.d + 1;
      const monthLen = prev.m <= 6 ? 31 : prev.m <= 11 ? 30 : 0;
      const ok =
        (j.y === prev.y && j.m === prev.m && j.d === nextDay) ||
        (j.d === 1 && ((j.m === prev.m + 1 && j.y === prev.y) || (prev.m === 12 && j.m === 1 && j.y === prev.y + 1))) ;
      assert.ok(ok, `پرش در ${gy}-${gm}-${gd}`);
      void monthLen;
    }
    prev = j;
    count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  assert.ok(count > 18000);
});

test('قالب نمایش', () => {
  assert.equal(formatJalali('2026-11-03'), '1405/08/12');
  assert.deepEqual(isoToJalali('2026-03-21'), { y: 1405, m: 1, d: 1 });
  assert.equal(isoToJalali('نامعتبر'), null);
});

// یادآورها: تاریخ، هشدار قیمت، اعلان‌های زمان‌بندی‌شده
const { openApp, reporter, jalaliYear } = require('./helpers.cjs');
(async () => {
  const t = reporter('reminders');
  const app = await openApp();
  const p = app.page;
  await app.tab('settings');
  await p.click('[data-action="ask"][data-v="reset"]'); await p.click('[data-action="ask-yes"]');
  await app.tab('home'); await p.waitForTimeout(900);
  t.ok((await app.sent('notify-sync')).length >= 1, 'فهرست اعلان‌ها به برنامه‌ی اندروید فرستاده می‌شود');
  await p.click('.bell'); await p.waitForTimeout(300);
  t.ok((await app.sent('notify-perm')).length >= 1, 'وضعیت اجازه‌ی اعلان پرسیده می‌شود');
  // یادآور تاریخ آینده
  await p.click('[data-action="rem-new-date"]');
  await p.fill('#r-title', 'سررسید آزمایشی'); await p.fill('#r-y', String(jalaliYear() + 1)); await p.fill('#r-m', '1'); await p.fill('#r-d', '15');
  await p.click('[data-action="rem-flead"][data-v="2"]');
  await p.click('[data-action="rem-save-date"]'); await p.waitForTimeout(300);
  let st = await app.store();
  const dr = st.reminders.find((r) => r.kind === 'date');
  t.ok(dr && dr.leadDays === 2, 'یادآور تاریخ ذخیره می‌شود');
  await p.waitForTimeout(800);
  const notes = (await app.sent('notify-sync')).at(-1).notes;
  t.ok(notes.some((n) => n.title === 'سررسید آزمایشی' && n.at > Date.now()), 'اعلان آینده زمان‌بندی می‌شود');
  // تاریخ نامعتبر
  await p.click('[data-action="rem-new-date"]'); await p.fill('#r-title', 'x'); await p.fill('#r-m', '14');
  await p.click('[data-action="rem-save-date"]');
  t.ok((await p.locator('#ferr').innerText()).length > 0, 'تاریخ نامعتبر رد می‌شود');
  await p.click('[data-action="rem-back"]');
  // هشدار قیمت
  await p.click('[data-action="rem-new-price"]');
  await p.selectOption('#r-asset', 'gold'); await p.waitForTimeout(200);
  await p.fill('#r-target', '۲۰۰۰۰۰۰۰');
  await p.click('[data-action="rem-save-price"]');
  t.ok((await p.locator('#ferr').innerText()).includes('همین حالا'), 'هدفی که همین الان برقرار است رد می‌شود');
  await p.fill('#r-target', '۳۰۰۰۰۰۰۰');
  await p.click('[data-action="rem-save-price"]'); await p.waitForTimeout(300);
  t.ok((await app.store()).reminders.some((r) => r.kind === 'price' && !r.firedAt), 'هشدار قیمت ثبت می‌شود');
  await p.click('[data-action="close"]');
  await app.tab('assets');
  await app.act('price', 'gold');
  await p.fill('#p-price', '۳۱۰۰۰۰۰۰'); await p.click('[data-action="price-save"]'); await p.waitForTimeout(400);
  const pr = (await app.store()).reminders.find((r) => r.kind === 'price');
  t.ok(!!pr.firedAt && (await app.sent('notify-now')).length === 1, 'با رسیدن قیمت، هشدار فعال و اعلان فوری فرستاده می‌شود');
  await p.click('.bell'); await p.waitForTimeout(300);
  await p.click(`[data-action="rem-rearm"][data-v="${pr.id}"]`); await p.waitForTimeout(200);
  t.ok(!!(await app.store()).reminders.find((r) => r.id === pr.id).firedAt, 'فعال‌سازی دوباره وقتی قیمت هنوز بالاست رد می‌شود');
  await p.click(`[data-action="rem-del"][data-v="${pr.id}"]`);
  await p.click(`[data-action="rem-done"][data-v="${dr.id}"]`); await p.waitForTimeout(200);
  st = await app.store();
  t.ok(st.reminders.length === 1 && st.reminders[0].done === true, 'حذف و «انجام شد» کار می‌کند');
  t.ok(app.errors.length === 0, 'بدون خطای اسکریپت ' + app.errors.join('|'));
  await app.close();
  process.exit(t.done() ? 1 : 0);
})();

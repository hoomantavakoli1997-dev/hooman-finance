// آزمون رمزنگاری اطلاعات روی گوشی.  اجرا: node e2e/encryption.cjs
const { KEY, openApp, reporter } = require('./helpers.cjs');
const t = reporter('encryption');

const K1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const K2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const NAME = 'سهم‌رازدار';
const plain = JSON.stringify({ v: 1, sample: false, assets: [{ id: 'a1', name: NAME, kind: 'stock', unit: 'سهم' }], txs: [], prices: {}, people: [], debts: [], payments: [], cheques: [], reminders: [], history: [], settings: { unit: 'toman', theme: 'system', font: 'normal' } });

(async () => {
  // ۱) مهاجرت از متن ساده: ذخیره‌ی رمزشده، متن ساده فقط بعد از تأیید پاک می‌شود
  let app = await openApp({ local: plain, key: K1, ack: true });
  await app.page.waitForTimeout(500);
  const snap = await app.page.evaluate(() => window.__lastSnap);
  const env = snap ? JSON.parse(snap) : null;
  t.ok(env && env.enc === 1 && env.iv && env.data, 'مهاجرت: پاکت رمزشده به بخش بومی فرستاده شد');
  t.ok(snap && !snap.includes(NAME) && !snap.includes('assets'), 'مهاجرت: در پاکت متن ساده دیده نمی‌شود');
  t.ok(await app.page.evaluate((k) => localStorage.getItem(k), KEY) === null, 'مهاجرت: بعد از تأیید، متن ساده از حافظه‌ی مرورگر پاک شد');
  const plainMsgs = (await app.sent('sqlite-snapshot')).filter((m) => m.snapshot.includes(NAME));
  t.ok(plainMsgs.length === 0, 'مهاجرت: هیچ نسخه‌ی متن ساده‌ای به SQLite نرفت');
  await app.tab('assets');
  t.ok((await app.page.content()).includes(NAME), 'مهاجرت: داده در رابط نمایش داده می‌شود');
  await app.tab('settings');
  t.ok((await app.page.textContent('body')).includes('AES-256'), 'تنظیمات: وضعیت رمزنگاری نمایش داده می‌شود');
  t.ok(app.errors.length === 0, 'بدون خطای جاوااسکریپت: ' + app.errors.join('|'));
  await app.close();

  // ۲) بوت دوباره فقط با نسخه‌ی رمزشده و کلید درست
  app = await openApp({ mirror: snap, key: K1, ack: true });
  await app.page.waitForTimeout(500);
  await app.tab('assets');
  t.ok((await app.page.content()).includes(NAME), 'بازکردن: اطلاعات رمزشده با کلید درست خوانده شد');
  t.ok(await app.page.locator('[data-action="recover-empty"]').count() === 0, 'بازکردن: پنجره‌ی بازیابی نیامد');
  // یک تغییر ذخیره می‌شود و رمزشده می‌رود
  await app.page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await app.close();

  // ۳) کلید اشتباه: چیزی بازنویسی نمی‌شود
  app = await openApp({ mirror: snap, key: K2, ack: true });
  await app.page.waitForTimeout(500);
  t.ok(await app.page.locator('[data-action="recover-empty"]').count() === 1, 'کلید اشتباه: پنجره‌ی بازیابی نشان داده شد');
  t.ok((await app.sent('sqlite-snapshot')).length === 0, 'کلید اشتباه: چیزی روی نسخه‌ی رمزشده نوشته نشد');
  await app.close();

  // ۴) نبودن کلید با داده‌ی رمزشده
  app = await openApp({ mirror: snap, ack: true });
  await app.page.waitForTimeout(500);
  t.ok(await app.page.locator('[data-action="recover-empty"]').count() === 1, 'بدون کلید: پنجره‌ی بازیابی نشان داده شد');
  t.ok((await app.sent('sqlite-snapshot')).length === 0, 'بدون کلید: چیزی نوشته نشد');
  await app.close();

  // ۵) بدون تأیید بومی، متن ساده پاک نمی‌شود
  app = await openApp({ local: plain, key: K1 });
  await app.page.waitForTimeout(500);
  t.ok(await app.page.evaluate((k) => localStorage.getItem(k), KEY) !== null, 'بدون تأیید: متن ساده نگه داشته شد');
  await app.close();

  // ۶) بدون کلید و بدون رمزنگاری: رفتار قبلی
  app = await openApp({ local: plain });
  t.ok(await app.page.evaluate((k) => localStorage.getItem(k), KEY) !== null, 'بدون رمزنگاری: همان ذخیره‌ی قبلی');
  t.ok((await app.sent('sqlite-snapshot')).some((m) => m.snapshot.includes(NAME)), 'بدون رمزنگاری: آینه‌ی قدیمی کار می‌کند');
  await app.close();

  process.exit(t.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// آزمون رابط راهنمای اول کار.  اجرا: node e2e/onboarding.cjs
const { openApp, reporter } = require('./helpers.cjs');
const t = reporter('onboarding');
const base = (extra = {}) => JSON.stringify({ v: 1, sample: false, assets: [], txs: [], prices: {}, people: [], debts: [], payments: [], cheques: [], reminders: [], history: [], settings: { unit: 'rial', theme: 'light', font: 'normal' }, ...extra });
(async () => {
  let app = await openApp({ local: base(), keepOnboarding: true });
  t.ok((await app.page.textContent('body')).includes('به دارا خوش آمدید'), 'کاربر تازه: راهنما نشان داده می‌شود');
  await app.act('onboard-next'); await app.act('onboard-next'); await app.act('onboard-next');
  t.ok((await app.page.textContent('body')).includes('اطلاعات را امن نگه دارید'), 'صفحه‌ی آخر');
  t.ok(await app.page.locator('[data-action="onboard-done"]').count() === 1, 'دکمه‌ی شروع');
  await app.act('onboard-prev');
  t.ok((await app.page.textContent('body')).includes('قیمت‌ها از کجا می‌آید'), 'برگشت به قبل');
  await app.act('onboard-done');
  t.ok((await app.store()).settings.onboarded === true, 'پس از پایان، دیگر نمایش داده نمی‌شود (ذخیره شد)');
  t.ok(await app.page.locator('.onb').count() === 0, 'پنجره بسته شد');
  await app.close();

  app = await openApp({ local: base({ settings: { unit: 'rial', theme: 'light', font: 'normal', onboarded: true } }), keepOnboarding: true });
  t.ok(await app.page.locator('.onb').count() === 0, 'ردشده: دوباره نشان داده نمی‌شود');
  await app.act('onboard-open');
  t.ok(await app.page.locator('.onb').count() === 1, 'از تنظیمات دوباره باز می‌شود');
  await app.close();

  app = await openApp({ keepOnboarding: true, local: base({ txs: [{ id: 't1', seq: 1, assetId: 'cash', type: 'deposit', date: '2026-01-01', quantity: '1000', unitPrice: '1', fee: '0' }] }) });
  t.ok(await app.page.locator('.onb').count() === 0, 'کاربر با داده: راهنما نمی‌آید');
  t.ok((await app.store()).settings.onboarded === true, 'کاربر با داده: علامت‌گذاری شد');
  t.ok(app.errors.length === 0, 'بدون خطای جاوااسکریپت: ' + app.errors.join('|'));
  await app.close();
  process.exit(t.done() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

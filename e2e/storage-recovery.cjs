// آزمون رابط: خرابی ذخیره‌سازی نباید داده را از بین ببرد.  اجرا: node e2e/storage-recovery.cjs
const { chromium, devices } = require('playwright');
const path = require('path');
const PAGE = 'file://' + path.resolve(__dirname, '../web/dist/android.html');
const KEY = 'hooman-finance-prototype-v1';
let failed = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) failed++; };

const goodStore = (name) => JSON.stringify({ v: 1, sample: false, assets: [{ id: 'a1', name, kind: 'stock', unit: 'سهم' }], txs: [], prices: {}, people: [], debts: [], payments: [], cheques: [], reminders: [], history: [], settings: { unit: 'toman', theme: 'system', font: 'normal' } });

async function open(init) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.addInitScript(({ init, KEY }) => {
    window.__sent = [];
    window.ReactNativeWebView = { postMessage: (m) => window.__sent.push(JSON.parse(m)) };
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      if (init.local !== undefined) localStorage.setItem(KEY, init.local);
      if (init.mirror) window.__DARA_SQLITE_SNAPSHOT = init.mirror;
    } else if (init.mirror) window.__DARA_SQLITE_SNAPSHOT = init.mirror;
  }, { init, KEY });
  await p.goto(PAGE);
  await p.waitForTimeout(400);
  return { b, p, errs };
}
const snapshots = (p) => p.evaluate(() => window.__sent.filter((x) => x.type === 'sqlite-snapshot').length);

(async () => {
  // ۱) داده‌ی خراب بدون آینه
  let { b, p, errs } = await open({ local: '{broken' });
  ok(await p.locator('[data-action="recover-empty"]').count() === 1, 'خراب: پنجره‌ی بازیابی نمایش داده می‌شود');
  ok(await p.locator('[data-action="recover-mirror"]').count() === 0, 'خراب بدون آینه: گزینه‌ی آینه نیست');
  ok(await p.evaluate((k) => localStorage.getItem(k), KEY) === '{broken', 'خراب: داده‌ی اصلی بازنویسی نشد');
  ok(await p.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('hooman-finance-corrupt-'))), 'خراب: کپی کنار گذاشته شد');
  ok(await snapshots(p) === 0, 'خراب: آینه‌ی SQLite با داده‌ی خالی بازنویسی نشد');
  await p.keyboard.press('Escape');
  ok(await p.locator('[data-action="recover-empty"]').count() === 1, 'خراب: با Escape بسته نمی‌شود');
  await p.click('[data-action="recover-empty"]');
  ok(await p.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)).v === 1; } catch { return false; } }, KEY), 'شروع خالی: ذخیره‌ی معتبر نوشته شد');
  ok(await p.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('hooman-finance-corrupt-'))), 'شروع خالی: کپی قبلی هنوز هست');
  ok(errs.length === 0, 'بدون خطای اسکریپت ' + errs.join('|'));
  await b.close();

  // ۲) داده‌ی خراب با آینه‌ی سالم
  ({ b, p, errs } = await open({ local: '{broken', mirror: goodStore('فملی') }));
  ok(await p.locator('[data-action="recover-mirror"]').count() === 1, 'آینه: گزینه‌ی بازیابی از آینه هست');
  await p.click('[data-action="recover-mirror"]');
  const st = await p.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  ok(st.assets.some((a) => a.name === 'فملی'), 'آینه: اطلاعات بازیابی و ذخیره شد');
  ok(await p.locator('[data-action="recover-empty"]').count() === 0, 'آینه: پنجره بسته شد');
  await b.close();

  // ۳) حافظه خالی ولی آینه سالم
  ({ b, p, errs } = await open({ mirror: goodStore('فولاد') }));
  ok(await p.locator('[data-action="recover-empty"]').count() === 0, 'آینه‌ی بدون خرابی: پنجره‌ی بازیابی نیست');
  ok((await p.evaluate((k) => localStorage.getItem(k), KEY) || '').includes('فولاد'), 'حافظه‌ی خالی: از آینه برگشت');
  await b.close();

  // ۴) راه‌اندازی عادی
  ({ b, p, errs } = await open({ local: goodStore('عادی') }));
  ok(await p.locator('[data-action="recover-empty"]').count() === 0, 'عادی: پنجره‌ی بازیابی نیست');
  ok(await snapshots(p) >= 1, 'عادی: آینه به‌روز می‌شود');
  // ۵) شکست ذخیره
  await p.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
  await p.click('button[data-action="tab"][data-v="settings"]');
  await p.evaluate(() => { const b = document.createElement('button'); b.dataset.action = 'set-font'; b.dataset.v = 'small'; document.body.appendChild(b); b.click(); b.remove(); });
  await p.waitForTimeout(300);
  ok((await p.locator('body').innerText()).includes('ذخیره‌ی اطلاعات انجام نشد'), 'شکست ذخیره: هشدار نمایش داده می‌شود');
  await b.close();

  console.log(failed ? `\n${failed} مورد ناموفق` : '\nهمه موفق');
  process.exit(failed ? 1 : 0);
})();

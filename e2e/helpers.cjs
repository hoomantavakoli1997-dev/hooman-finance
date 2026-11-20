const { chromium, devices } = require('playwright');
const path = require('path');

const KEY = 'hooman-finance-prototype-v1';
const PAGE = 'file://' + path.resolve(__dirname, '../web/dist/android.html');

function reporter(name) {
  let failed = 0;
  return {
    ok(cond, msg) { console.log(`${cond ? 'ok  ' : 'FAIL'} [${name}] ${msg}`); if (!cond) failed++; },
    done() { if (failed) console.log(`[${name}] ${failed} مورد ناموفق`); return failed; },
  };
}

/** صفحه‌ی برنامه با شبیه‌ساز پل اندروید */
async function openApp(init = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], timezoneId: 'Asia/Tehran' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(({ init, KEY }) => {
    window.__sent = [];
    window.__APP_BUILD = 1;
    window.ReactNativeWebView = {
      postMessage: (m) => {
        const msg = JSON.parse(m);
        window.__sent.push(msg);
        // شبیه‌ساز بخش بومی: ذخیره‌ی رمزشده را تأیید می‌کند
        if (init.ack && msg.type === 'sqlite-snapshot' && typeof msg.ack === 'number') {
          window.__lastSnap = msg.snapshot;
          setTimeout(() => window.__encAck && window.__encAck(msg.ack, true), 20);
        }
      },
    };
    if (init.key) window.__DARA_KEY = init.key;
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      if (init.local !== undefined) localStorage.setItem(KEY, init.local);
    }
    if (init.mirror) window.__DARA_SQLITE_SNAPSHOT = init.mirror;
  }, { init, KEY });
  await page.goto(PAGE);
  await page.waitForTimeout(400);
  const api = {
    browser, page, errors,
    store: () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY),
    sent: (type) => page.evaluate((t) => window.__sent.filter((x) => x.type === t), type),
    tab: (name) => page.click(`button[data-action="tab"][data-v="${name}"]`),
    /** اجرای یک action بدون نیاز به دیدن دکمه‌اش */
    act: (action, v) => page.evaluate(([a, v]) => { const b = document.createElement('button'); b.dataset.action = a; if (v !== undefined) b.dataset.v = v; document.body.appendChild(b); b.click(); b.remove(); }, [action, v]),
    close: () => browser.close(),
  };
  return api;
}

/** سال شمسی جاری (برای تاریخ‌های آینده‌ی پایدار در تست) */
function jalaliYear() {
  return Number(new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric' }).format(new Date()).replace(/\D/g, '').slice(0, 4));
}

module.exports = { KEY, openApp, reporter, jalaliYear };

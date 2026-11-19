// چک‌ها: سرمایه‌ی خالص، وصول‌شده ← نقد، چک تکراری، برگشت وضعیت
const { openApp, reporter } = require('./helpers.cjs');
(async () => {
  const t = reporter('cheques');
  const app = await openApp();
  const p = app.page;
  const num = (s) => Number(s.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^\d]/g, '') || 0);
  const net = async () => { await app.tab('home'); return num(await p.locator('.hero .big').innerText()); };
  const cashMini = async () => { await app.tab('home'); return num((await p.locator('.hero .mini span').first().innerText())); };
  const addCheque = async (dir, number, amount, status) => {
    await app.tab('people');
    await p.click(`[data-action="check-new"][data-v="${dir}"]`);
    await p.fill('#ck-number', number); await p.fill('#ck-bank', 'ملی'); await p.fill('#ck-holder', 'علی'); await p.fill('#ck-amount', amount);
    if (status) await p.selectOption('#ck-status', status);
    await p.click('[data-action="check-save"]'); await p.waitForTimeout(250);
  };
  const edit = async (number, status) => {
    await app.tab('people');
    const id = (await app.store()).cheques.find((c) => c.number === number).id;
    await app.act('check-edit', id); await p.waitForTimeout(150);
    await p.selectOption('#ck-status', status);
    await p.click('[data-action="check-save"]'); await p.waitForTimeout(250);
    return id;
  };
  t.ok(await net() === 0, 'شروع: سرمایه صفر');
  await addCheque('received', '111', '۱۰۰۰۰۰۰', 'pending');
  t.ok(await net() === 1000000, 'چک دریافتی باز در سرمایه‌ی خالص حساب می‌شود');
  t.ok(await cashMini() === 0, 'هنوز به نقد اضافه نشده');
  // تکراری
  await app.tab('people'); await p.click('[data-action="check-new"][data-v="received"]');
  await p.fill('#ck-number', '1 11'); await p.fill('#ck-bank', 'ملی'); await p.fill('#ck-holder', 'x'); await p.fill('#ck-amount', '5');
  await p.click('[data-action="check-save"]');
  t.ok((await p.locator('#ferr').innerText()).includes('قبلاً'), 'چک تکراری رد می‌شود');
  await p.click('[data-action="close"]');
  // وصول
  await edit('111', 'cleared');
  let st = await app.store();
  const cashTx = st.txs.find((x) => x.assetId === 'cash' && !x.deletedAt);
  t.ok(cashTx && cashTx.type === 'deposit' && cashTx.quantity === '10000000', 'وصول چک دریافتی: واریز به نقد ساخته می‌شود');
  t.ok(await net() === 1000000, 'سرمایه‌ی خالص با وصول تغییر نمی‌کند');
  t.ok(await cashMini() === 1000000, 'نقد افزایش می‌یابد');
  // برگشت وضعیت
  await edit('111', 'pending');
  st = await app.store();
  t.ok(st.txs.filter((x) => x.assetId === 'cash' && !x.deletedAt).length === 0, 'برگشت وضعیت: واریز برداشته می‌شود');
  t.ok(await net() === 1000000 && await cashMini() === 0, 'برگشت وضعیت: سرمایه ثابت و نقد صفر');
  // چک برگشتی دریافتی قابل‌وصول نیست
  await edit('111', 'bounced');
  t.ok(await net() === 0, 'چک دریافتیِ برگشتی در سرمایه حساب نمی‌شود');
  await edit('111', 'pending');
  // چک پرداختی
  await addCheque('issued', '222', '۵۰۰۰۰۰', 'pending');
  t.ok(await net() === 500000, 'چک پرداختی باز از سرمایه کم می‌شود');
  await edit('111', 'cleared');
  await edit('222', 'cleared');
  st = await app.store();
  t.ok(st.cheques.find((c) => c.number === '222').status === 'cleared', 'پرداختی با نقد کافی وصول می‌شود');
  t.ok(await cashMini() === 500000 && await net() === 500000, 'نقد و سرمایه بعد از هر دو وصول درست است');
  // پرداختی بدون نقد کافی: انجام می‌شود ولی نقد منفی و هشدار می‌دهد (مثل بقیه‌ی معاملات)
  await addCheque('issued', '333', '۹۰۰۰۰۰۰', 'pending');
  await edit('333', 'cleared');
  t.ok((await p.locator('body').innerText()).includes('نقد منفی شد'), 'وصول پرداختی بدون نقد کافی، هشدار نقد منفی می‌دهد');
  await app.tab('home');
  t.ok(/[-−]/.test(await p.locator('.hero .mini span').first().innerText()), 'نقد منفی نمایش داده می‌شود');
  t.ok(app.errors.length === 0, 'بدون خطای اسکریپت ' + app.errors.join('|'));
  await app.close();
  process.exit(t.done() ? 1 : 0);
})();

// همه‌ی آزمون‌های رابط را پشت‌سرهم اجرا می‌کند؛ با اولین شکست کد خروج ۱ می‌دهد.
const { spawnSync } = require('child_process');
const path = require('path');
let bad = 0;
for (const f of ['storage-recovery', 'lock', 'reminders', 'cheques', 'encryption', 'realreturn', 'income', 'report']) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f + '.cjs')], { stdio: 'inherit' });
  if (r.status !== 0) { bad++; console.log(`>>> ${f} ناموفق`); }
}
process.exit(bad ? 1 : 0);

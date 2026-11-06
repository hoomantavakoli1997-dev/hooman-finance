import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// esbuild: از node_modules پروژه، یا مسیر دلخواه با متغیر ESBUILD
const esbuild = process.env.ESBUILD || 'node_modules/.bin/esbuild';
// نمونه‌ی ذخیره‌شده‌ی نمای بازار: فقط قیمت‌های سال ۲۰۲۶ از پاسخ واقعی TGJU
const fixture = JSON.parse(fs.readFileSync('src/core/fixtures/tgju-ajax.sample.json', 'utf8'));
const keep = {};
for (const [k, v] of Object.entries(fixture.current)) {
  if (typeof v.ts === 'string' && v.ts >= '2026-01-01') {
    keep[k] = { p: v.p, h: v.h, l: v.l, d: v.d, dp: v.dp, dt: v.dt, ts: v.ts };
  }
}
fs.writeFileSync('web/market-sample.json', JSON.stringify({ current: keep }));

const js = execFileSync(
  esbuild,
  ['web/app.ts', '--bundle', '--minify', '--format=iife', '--target=es2020', '--charset=utf8'],
  { encoding: 'utf8', maxBuffer: 1e8 },
);
const tpl = fs.readFileSync('web/template.html', 'utf8');
fs.mkdirSync('web/dist', { recursive: true });
fs.writeFileSync(
  'web/dist/index.html',
  tpl.replace('/*__BUNDLE__*/', () => js.replace(/<\/script/gi, '<\\/script')),
);
console.log('web/dist/index.html', fs.statSync('web/dist/index.html').size, 'bytes');

// برای اپ اندروید: همان صفحه به‌صورت رشته داخل برنامه قرار می‌گیرد (وب‌ویو).
// برخلاف نسخه‌ی منتشرشده، اینجا قالب کامل HTML لازم است (doctype، viewport و حاشیه‌ی ایمن).
const nativeHtml =
  '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
  '<style>html{color-scheme:light dark}body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style></head><body>' +
  fs.readFileSync('web/dist/index.html', 'utf8') +
  '</body></html>';
fs.writeFileSync('web/dist/android.html', nativeHtml);
fs.mkdirSync('src/native', { recursive: true });
fs.writeFileSync(
  'src/native/appHtml.ts',
  '// تولیدشده با web/build.mjs؛ دستی ویرایش نشود.\nconst html: string = ' +
    JSON.stringify(nativeHtml).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') +
    ';\nexport default html;\n',
);
console.log('src/native/appHtml.ts written');

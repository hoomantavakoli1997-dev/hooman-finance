# گواهی‌های اضافه‌ی اعتماد

`certum_trusted_root_ca.pem` — ریشه‌ی «Certum Trusted Root CA» (Asseco Data Systems S.A.)

- سرور `cdn.tsetmc.com` گواهی خود را از «Certum DV TLS G2 R39 CA» می‌گیرد که زیر این ریشه است.
- این ریشه روی بعضی گوشی‌های اندرویدی قدیمی‌تر از ۱۴ (بدون به‌روزرسانی گواهی‌ها) نیست و اتصال با خطای
  «The certificate authority is not trusted» قطع می‌شود.
- اثر انگشت SHA-256: `FE:76:96:57:38:55:77:3E:37:A9:5E:7A:D4:D9:CC:96:C3:01:57:C1:5D:31:76:5B:A9:B1:57:04:E1:AE:78:FD`
- منبع: فهرست ریشه‌های موزیلا (بسته‌ی certifi)؛ مشخصات با اطلاعیه‌ی Certum (support.certum.eu) تطبیق داده شد.
- در ساخت APK فقط برای دامنه‌ی `cdn.tsetmc.com` در `network_security_config` اضافه می‌شود؛ برای بقیه‌ی سایت‌ها
  فقط فهرست خود اندروید معتبر است و هیچ بررسی امنیتی خاموش نمی‌شود.

/**
 * نتیجه‌ی `PRAGMA quick_check` یک ردیف با ستونی به نام `quick_check` است (نه `integrity_check`).
 * نام ستون را ثابت فرض نمی‌کنیم و فقط مقدار اولین ستون را می‌خوانیم: سالم یعنی دقیقاً «ok».
 */
export function isIntegrityOk(row: unknown): boolean {
  if (!row || typeof row !== 'object') return false;
  const values = Object.values(row as Record<string, unknown>);
  return values.length === 1 && values[0] === 'ok';
}

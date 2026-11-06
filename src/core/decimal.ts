/**
 * عدد اعشاری دقیق مبتنی بر BigInt (کسر کاهش‌یافته).
 * هیچ خطای ممیز شناور ندارد و تقسیم هم دقیق نگه داشته می‌شود؛
 * گرد کردن فقط هنگام نمایش/خروجی (round) انجام می‌شود.
 */

function absB(a: bigint): bigint {
  return a < 0n ? -a : a;
}

function gcd(a: bigint, b: bigint): bigint {
  a = absB(a);
  b = absB(b);
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

type Num = Decimal | string | number | bigint;

const NUM_RE = /^([+-]?)(\d+)(?:\.(\d+))?$/;

export class Decimal {
  readonly n: bigint; // صورت (علامت‌دار)
  readonly d: bigint; // مخرج (همیشه مثبت)

  private constructor(n: bigint, d: bigint) {
    if (d === 0n) throw new Error('Division by zero');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    this.n = g > 1n ? n / g : n;
    this.d = g > 1n ? d / g : d;
  }

  /** رشته‌ی اعشاری ساده (مثل "12.50" یا "-3")؛ در غیر این صورت خطا می‌دهد */
  static parse(v: string): Decimal {
    const m = NUM_RE.exec(v.trim());
    if (!m) throw new Error(`Invalid number: ${v}`);
    const [, sign, int, frac = ''] = m;
    const n = BigInt(int + frac) * (sign === '-' ? -1n : 1n);
    return new Decimal(n, 10n ** BigInt(frac.length));
  }

  static of(v: string | number | bigint | Decimal): Decimal {
    if (v instanceof Decimal) return v;
    if (typeof v === 'bigint') return new Decimal(v, 1n);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('Invalid number');
      return Decimal.parse(String(v));
    }
    return Decimal.parse(v);
  }

  static readonly ZERO = new Decimal(0n, 1n);
  static readonly ONE = new Decimal(1n, 1n);

  plus(x: Num): Decimal {
    const o = Decimal.of(x);
    return new Decimal(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  minus(x: Num): Decimal {
    const o = Decimal.of(x);
    return new Decimal(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(x: Num): Decimal {
    const o = Decimal.of(x);
    return new Decimal(this.n * o.n, this.d * o.d);
  }
  div(x: Num): Decimal {
    const o = Decimal.of(x);
    if (o.n === 0n) throw new Error('Division by zero');
    return new Decimal(this.n * o.d, this.d * o.n);
  }
  neg(): Decimal {
    return new Decimal(-this.n, this.d);
  }

  cmp(x: Num): number {
    const o = Decimal.of(x);
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  eq(o: Num) { return this.cmp(o) === 0; }
  lt(o: Num) { return this.cmp(o) < 0; }
  lte(o: Num) { return this.cmp(o) <= 0; }
  gt(o: Num) { return this.cmp(o) > 0; }
  gte(o: Num) { return this.cmp(o) >= 0; }

  isInteger() { return this.d === 1n; }
  isZero() { return this.n === 0n; }
  isNegative() { return this.n < 0n; }

  /**
   * گرد کردن به عدد صحیح؛ نیم‌ها از صفر دور می‌شوند (۲٫۵ → ۳ و ‎−۲٫۵ → ‎−۳)
   */
  roundToInt(): bigint {
    const a = absB(this.n);
    const q = a / this.d;
    const r = a % this.d;
    const up = r * 2n >= this.d ? 1n : 0n;
    const res = q + up;
    return this.n < 0n ? -res : res;
  }

  /** گرد کردن به تعداد مشخص رقم اعشار و برگرداندن Decimal */
  round(places = 0): Decimal {
    const scale = 10n ** BigInt(places);
    return new Decimal(this.mul(new Decimal(scale, 1n)).roundToInt(), scale);
  }

  toNumber(): number {
    return Number(this.n) / Number(this.d);
  }

  /** رشته‌ی اعشاری با تعداد رقم اعشار ثابت (پس از گرد کردن) */
  toFixed(places = 0): string {
    const scaled = this.mul(new Decimal(10n ** BigInt(places), 1n)).roundToInt();
    const neg = scaled < 0n;
    let s = absB(scaled).toString();
    if (places > 0) {
      s = s.padStart(places + 1, '0');
      s = `${s.slice(0, -places)}.${s.slice(-places)}`;
    }
    return (neg ? '-' : '') + s;
  }

  toString(): string {
    return this.d === 1n ? this.n.toString() : this.toFixed(10);
  }
}

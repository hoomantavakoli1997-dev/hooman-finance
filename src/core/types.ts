export const CASH_ID = 'cash';

/** receive = دریافت بدون خرید (هدیه، پاداش، حقوق جنسی): مقدار زیاد می‌شود، نقد دست نمی‌خورد */
export type TxType = 'buy' | 'sell' | 'receive' | 'deposit' | 'withdraw';
export type AssetKind = 'cash' | 'metal' | 'currency' | 'crypto' | 'custom';

export interface Asset {
  id: string;
  name: string;
  unit: string;
  kind: AssetKind;
  /** تعداد رقم اعشار مجاز برای مقدار */
  decimals: number;
  /** کلید این دارایی در هر منبع قیمت: { tgju: 'geram18' }؛ اگر خالی باشد از نگاشت پیش‌فرض استفاده می‌شود */
  priceKeys?: Record<string, string>;
}

/**
 * مقدار، قیمت و کارمزد به‌صورت رشته‌ی اعشاری ذخیره می‌شوند (نه float).
 * همه‌ی مبالغ به ریال هستند؛ تومان فقط در نمایش است.
 * برای وجه نقد: assetId = 'cash'، مقدار = مبلغ به ریال، قیمت واحد = '1'.
 */
export interface Tx {
  id: string;
  /** شماره ترتیب ثبت؛ برای ترتیب معاملات هم‌تاریخ */
  seq: number;
  assetId: string;
  type: TxType;
  /** تاریخ میلادی YYYY-MM-DD */
  date: string;
  quantity: string;
  unitPrice: string;
  fee: string;
  note?: string;
  /** حذف نرم: اگر پر باشد معامله محاسبه نمی‌شود اما قابل بازیابی است */
  deletedAt?: string | null;
}

export interface PriceEntry {
  assetId: string;
  /** ریال به ازای هر واحد */
  price: string;
  source: 'manual' | 'auto';
  /** زمان ثبت (دستی) یا زمان قیمت در بازار (خودکار)، به‌صورت ISO */
  at: string;
  /** فقط برای خودکار: نام منبع */
  provider?: string;
  /** فقط برای خودکار: زمان دریافت (ISO) */
  fetchedAt?: string;
  /** فقط برای خودکار: منبع فقط تاریخ داده (ساعت ندارد) */
  dateOnly?: boolean;
}

export interface ValidationIssue {
  code: 'BAD_FIELD' | 'BAD_TYPE' | 'OVERSELL' | 'NEGATIVE_CASH';
  severity: 'error' | 'warning';
  txId: string;
  assetId: string;
  message: string;
}

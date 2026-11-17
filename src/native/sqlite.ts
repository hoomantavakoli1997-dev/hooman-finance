/**
 * SQLite persistence foundation for the Android WebView app.
 *
 * This module intentionally stores the complete validated app state as one
 * atomic JSON snapshot. It avoids a risky partial relational migration while
 * preserving the existing Store schema and financial calculations.
 *
 * The WebView/native bridge must call initializeDatabase(), readSnapshot(),
 * importLegacySnapshot() and writeSnapshot() before this becomes the source
 * of truth. Do not remove the current localStorage path until that bridge and
 * its migration tests are in place.
 */
import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'dara.db';
const SNAPSHOT_ID = 1;
const SCHEMA_VERSION = 1;
const MAX_SNAPSHOT_CHARS = 10 * 1024 * 1024;

export interface DaraSnapshot {
  v: 1;
  assets: unknown[];
  txs: unknown[];
  settings: Record<string, unknown>;
  [key: string]: unknown;
}

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

function isSnapshot(value: unknown): value is DaraSnapshot {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return state.v === 1 &&
    Array.isArray(state.assets) &&
    Array.isArray(state.txs) &&
    !!state.settings && typeof state.settings === 'object' && !Array.isArray(state.settings);
}

export async function initializeDatabase(): Promise<void> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS dara_metadata (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS dara_state (
          id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
          schema_version INTEGER NOT NULL,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      await db.runAsync(
        'INSERT INTO dara_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
        'schema_version',
        String(SCHEMA_VERSION),
      );
      return db;
    })().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }
  await databasePromise;
}

async function db(): Promise<SQLite.SQLiteDatabase> {
  await initializeDatabase();
  return databasePromise!;
}

/** Returns null only when no SQLite snapshot exists yet. */
export async function readSnapshot(): Promise<DaraSnapshot | null> {
  const connection = await db();
  const row = await connection.getFirstAsync<{ payload: string; schema_version: number }>(
    'SELECT payload, schema_version FROM dara_state WHERE id = ?',
    SNAPSHOT_ID,
  );
  if (!row) return null;
  if (row.schema_version !== SCHEMA_VERSION) {
    throw new Error('نسخه ساختار پایگاه داده پشتیبانی نمی‌شود.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payload);
  } catch {
    throw new Error('اطلاعات ذخیره‌شده دارا قابل خواندن نیست؛ نسخه پشتیبان را حفظ کنید.');
  }
  if (!isSnapshot(parsed)) {
    throw new Error('ساختار اطلاعات ذخیره‌شده معتبر نیست؛ داده‌ها بازنویسی نشدند.');
  }
  return parsed;
}

/**
 * Imports the old WebView localStorage payload only when SQLite is empty.
 * The caller must keep the legacy copy until it verifies a successful read-back.
 */
export async function importLegacySnapshot(legacyJson: string): Promise<boolean> {
  const existing = await readSnapshot();
  if (existing) return false;
  if (legacyJson.length > MAX_SNAPSHOT_CHARS) {
    throw new Error('حجم اطلاعات قدیمی بیش از حد مجاز است.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(legacyJson);
  } catch {
    throw new Error('اطلاعات نسخه قبلی قابل خواندن نیست؛ نسخه پشتیبان را حفظ کنید.');
  }
  if (!isSnapshot(parsed)) {
    throw new Error('اطلاعات نسخه قبلی ساختار معتبر ندارد؛ چیزی وارد نشد.');
  }
  await writeSnapshot(parsed);
  const verified = await readSnapshot();
  if (!verified || JSON.stringify(verified) !== JSON.stringify(parsed)) {
    throw new Error('تأیید انتقال اطلاعات انجام نشد؛ نسخه قبلی دست‌نخورده باقی بماند.');
  }
  return true;
}

/** Atomic single-row replacement; a failed write leaves the prior snapshot intact. */
export async function writeSnapshot(snapshot: DaraSnapshot): Promise<void> {
  if (!isSnapshot(snapshot)) throw new Error('ساختار اطلاعات برای ذخیره‌سازی معتبر نیست.');
  const payload = JSON.stringify(snapshot);
  if (payload.length > MAX_SNAPSHOT_CHARS) throw new Error('حجم اطلاعات بیش از حد مجاز است.');
  const connection = await db();
  await connection.runAsync(
    `INSERT INTO dara_state (id, schema_version, payload, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       schema_version = excluded.schema_version,
       payload = excluded.payload,
       updated_at = excluded.updated_at`,
    SNAPSHOT_ID,
    SCHEMA_VERSION,
    payload,
    new Date().toISOString(),
  );
}

/** SQLite's built-in integrity check; callers should surface a failure to the user. */
export async function checkDatabaseIntegrity(): Promise<boolean> {
  const connection = await db();
  const result = await connection.getFirstAsync<{ integrity_check: string }>('PRAGMA quick_check');
  return result?.integrity_check === 'ok';
}

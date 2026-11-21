/**
 * هشدار قیمت در پس‌زمینه (وقتی برنامه بسته است). باید در ورودی برنامه import شود تا تعریف وظیفه
 * هنگام اجرای بدون رابط هم ثبت شود. اطلاعات مالی (مقدار دارایی، سرمایه) هرگز در این فایل نیست؛
 * فقط نام دارایی، کلید منبع قیمت و قیمت هدف هشدارها.
 */
import * as BackgroundFetch from 'expo-background-fetch';
import * as FileSystem from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { BgAlert, BgConfig, EMPTY_BG, dropFired, evaluateAlerts, hitText, sanitizeBg } from '../src/native/bgAlerts';
import { Quote, tgjuProvider } from '../src/core/prices';
import { tsetmcProvider } from '../src/core/tsetmc';

export const BG_TASK = 'dara-price-alerts';
const FILE = (FileSystem.documentDirectory ?? '') + 'dara-bg-alerts.json';
const CHANNEL = 'reminders';

async function read(): Promise<BgConfig> {
  try {
    return sanitizeBg(JSON.parse(await FileSystem.readAsStringAsync(FILE))) ?? EMPTY_BG;
  } catch {
    return EMPTY_BG;
  }
}
const write = (c: BgConfig) => FileSystem.writeAsStringAsync(FILE, JSON.stringify(c));

const netFetch = (url: string) =>
  fetch(url, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    },
  });

async function collectQuotes(alerts: BgAlert[]): Promise<Map<string, Quote>> {
  const m = new Map<string, Quote>();
  if (alerts.some((a) => a.provider === 'tgju')) {
    try {
      for (const q of await tgjuProvider(netFetch).fetchQuotes()) m.set(`tgju:${q.key}`, q);
    } catch { /* ادامه با منبع بعدی */ }
  }
  const codes = alerts.filter((a) => a.provider === 'tsetmc').map((a) => a.key);
  if (codes.length) {
    try {
      for (const q of await tsetmcProvider(netFetch, codes).fetchQuotes()) m.set(`tsetmc:${q.key}`, q);
    } catch { /* بورس ممکن است بدون مرورگر در دسترس نباشد؛ هشداری ساخته نمی‌شود */ }
  }
  return m;
}

TaskManager.defineTask(BG_TASK, async () => {
  try {
    const cfg = await read();
    if (!cfg.alerts.length) return BackgroundFetch.BackgroundFetchResult.NoData;
    const hits = evaluateAlerts(cfg.alerts, await collectQuotes(cfg.alerts), Date.now());
    if (!hits.length) return BackgroundFetch.BackgroundFetchResult.NoData;
    const fired = [...cfg.fired];
    for (const h of hits) {
      const { title, body } = hitText(h, cfg.unit);
      await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: { channelId: CHANNEL } });
      fired.push(h.alert.id);
    }
    await write({ ...cfg, alerts: dropFired(cfg.alerts, fired), fired });
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * فهرست هشدارهای برنامه را ذخیره می‌کند و هشدارهای فعال‌شده‌ی پس‌زمینه را برمی‌گرداند
 * (برای علامت‌گذاری در برنامه، بدون اعلان دوباره).
 */
export async function syncBgAlerts(raw: unknown): Promise<{ fired: string[]; active: boolean } | null> {
  const next = sanitizeBg(raw);
  if (!next) return null;
  const old = await read();
  const fired = [...new Set(old.fired)];
  const alerts = dropFired(next.alerts, fired);
  await write({ alerts, unit: next.unit, fired: [] });
  return { fired, active: alerts.length > 0 };
}

export async function ensureBgTask(active: boolean): Promise<void> {
  try {
    const on = await TaskManager.isTaskRegisteredAsync(BG_TASK);
    if (active && !on) {
      await BackgroundFetch.registerTaskAsync(BG_TASK, { minimumInterval: 15 * 60, stopOnTerminate: false, startOnBoot: true });
    } else if (!active && on) {
      await BackgroundFetch.unregisterTaskAsync(BG_TASK);
    }
  } catch {
    // اگر سیستم اجازه‌ی کار پس‌زمینه ندهد، هشدارها فقط هنگام باز بودن برنامه بررسی می‌شوند
  }
}

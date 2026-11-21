import React from 'react';
import * as FileSystem from 'expo-file-system';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { MarketWidget } from './MarketWidget';
import { EMPTY_WIDGET, WidgetConfig, buildRows, sanitizeConfig } from '../src/native/widgetData';
import { parseMarket, snapshotTime } from '../src/core/market';
import { TGJU_URL } from '../src/core/prices';

export const WIDGET_FILE = (FileSystem.documentDirectory ?? '') + 'dara-widget.json';

export async function readWidgetConfig(): Promise<WidgetConfig> {
  try {
    return sanitizeConfig(JSON.parse(await FileSystem.readAsStringAsync(WIDGET_FILE))) ?? EMPTY_WIDGET;
  } catch {
    return EMPTY_WIDGET;
  }
}

export async function writeWidgetConfig(cfg: WidgetConfig): Promise<void> {
  await FileSystem.writeAsStringAsync(WIDGET_FILE, JSON.stringify(cfg));
}

/** قیمت‌ها را مستقیم از TGJU می‌گیرد؛ اگر نشد، آخرین ردیف‌های ذخیره‌شده با زمان واقعی خودشان می‌مانند */
async function refreshFromNetwork(cfg: WidgetConfig): Promise<WidgetConfig> {
  if (!cfg.keys.length) return cfg;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(TGJU_URL, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json, text/plain, */*', 'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8' },
    });
    if (!res.ok) return cfg;
    const entries = parseMarket(await res.text());
    const rows = buildRows(entries, cfg.keys, cfg.unit);
    if (!rows.length) return cfg;
    const t = snapshotTime(entries);
    const next: WidgetConfig = { ...cfg, rows, updatedAt: t ? new Date(t + 3.5 * 3600e3).toISOString().slice(0, 19) : cfg.updatedAt };
    await writeWidgetConfig(next);
    return next;
  } catch {
    return cfg;
  } finally {
    clearTimeout(timer);
  }
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      const cfg = await refreshFromNetwork(await readWidgetConfig());
      props.renderWidget(<MarketWidget cfg={cfg} />);
      break;
    }
    default:
      break;
  }
}

export const renderMarketWidget = async (cfg: WidgetConfig) => <MarketWidget cfg={cfg} />;

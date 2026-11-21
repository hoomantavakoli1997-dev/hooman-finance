import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetConfig } from '../src/native/widgetData';

const NAVY = '#0b1f3a' as const;
const TEAL = '#2cd2cd' as const;
const INK = '#d7e8ef' as const;
const MUTED = '#8aa3b5' as const;
const UP = '#6fe7a8' as const;
const DOWN = '#ff9a8a' as const;

function hhmm(iso: string | null): string {
  if (!iso) return '';
  const m = /T(\d{2}:\d{2})/.exec(iso);
  return m ? m[1] : '';
}

export function MarketWidget({ cfg }: { cfg: WidgetConfig }) {
  const time = hhmm(cfg.updatedAt);
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{ width: 'match_parent', height: 'match_parent', backgroundColor: NAVY, borderRadius: 18, padding: 12, flexDirection: 'column' }}
    >
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <TextWidget text="دارا" style={{ fontSize: 15, fontWeight: 'bold', color: TEAL }} />
        {cfg.worth ? <TextWidget text={cfg.worth} style={{ fontSize: 14, fontWeight: 'bold', color: '#ffffff' }} /> : <TextWidget text="" style={{ fontSize: 1, color: NAVY }} />}
      </FlexWidget>
      {cfg.rows.length === 0 ? (
        <TextWidget
          text="در برنامه‌ی دارا از «نمای بازار» چند قیمت را ستاره‌دار کنید تا اینجا نشان داده شود."
          style={{ fontSize: 12, color: MUTED, marginTop: 8 }}
        />
      ) : (
        cfg.rows.map((r, i) => (
          <FlexWidget key={i} style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 }}>
            <TextWidget text={r.label} style={{ fontSize: 12, color: INK }} maxLines={1} truncate="END" />
            <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextWidget text={r.price} style={{ fontSize: 12, fontWeight: 'bold', color: '#ffffff' }} />
              {r.change ? <TextWidget text={'  ' + r.change} style={{ fontSize: 10, color: r.dir === 'down' ? DOWN : UP }} /> : <TextWidget text="" style={{ fontSize: 1, color: NAVY }} />}
            </FlexWidget>
          </FlexWidget>
        ))
      )}
      {time ? <TextWidget text={`آخرین قیمت دریافتی: ${time}`} style={{ fontSize: 10, color: MUTED, marginTop: 6 }} /> : <TextWidget text="" style={{ fontSize: 1, color: NAVY }} />}
    </FlexWidget>
  );
}

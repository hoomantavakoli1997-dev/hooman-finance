import React from 'react';
import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetConfig } from '../src/native/widgetData';

const NAVY = '#0b1f3a' as const;
const PANEL = '#123c66' as const;
const TEAL = '#2cd2cd' as const;
const GOLD = '#f2c66d' as const;
const INK = '#d7e8ef' as const;
const MUTED = '#8aa3b5' as const;
const UP = '#6fe7a8' as const;
const DOWN = '#ff9a8a' as const;

/** نشان دارا (همان assets/brand/dara-mark.svg) */
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><rect width="108" height="108" rx="25" fill="#0B1F3A"/><rect x="12" y="13" width="84" height="82" rx="19" fill="#123C66"/><path d="M25 25h10v58H25z" fill="#2CD2CD"/><path d="M44 25h13c18 0 29 10 29 29S75 83 57 83H44V25zm10 10v38h3c12 0 19-7 19-19s-7-19-19-19h-3z" fill="#F2C66D"/></svg>`;

const blank = <TextWidget text="" style={{ fontSize: 1, color: NAVY }} />;

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
      style={{ width: 'match_parent', height: 'match_parent', backgroundColor: NAVY, borderRadius: 22, padding: 10, flexDirection: 'column' }}
    >
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
          <SvgWidget svg={LOGO} style={{ width: 30, height: 30 }} />
          <FlexWidget style={{ flexDirection: 'column', marginLeft: 8 }}>
            <TextWidget text="دارا" style={{ fontSize: 15, fontWeight: 'bold', color: '#ffffff' }} />
            <TextWidget text="DARA" style={{ fontSize: 8, color: TEAL, letterSpacing: 2 }} />
          </FlexWidget>
        </FlexWidget>
        {cfg.worth ? (
          <FlexWidget style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
            <TextWidget text="سرمایه‌ی خالص" style={{ fontSize: 9, color: MUTED }} />
            <TextWidget text={cfg.worth} style={{ fontSize: 13, fontWeight: 'bold', color: GOLD }} />
          </FlexWidget>
        ) : blank}
      </FlexWidget>
      <FlexWidget style={{ width: 'match_parent', height: 2, backgroundColor: TEAL, marginTop: 7, marginBottom: 3, borderRadius: 2 }} />
      {cfg.rows.length === 0 ? (
        <TextWidget
          text="در برنامه‌ی دارا از «نمای بازار» چند قیمت را ستاره‌دار کنید تا اینجا نشان داده شود."
          style={{ fontSize: 12, color: MUTED, marginTop: 8 }}
        />
      ) : (
        cfg.rows.map((r, i) => (
          <FlexWidget
            key={i}
            style={{
              width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
              backgroundColor: i % 2 === 0 ? PANEL : NAVY, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 8, marginTop: 3,
            }}
          >
            <TextWidget text={r.label} style={{ fontSize: 12, color: INK }} maxLines={1} truncate="END" />
            <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextWidget text={r.price} style={{ fontSize: 12, fontWeight: 'bold', color: '#ffffff' }} />
              {r.change ? <TextWidget text={'  ' + r.change} style={{ fontSize: 10, fontWeight: 'bold', color: r.dir === 'down' ? DOWN : UP }} /> : blank}
            </FlexWidget>
          </FlexWidget>
        ))
      )}
      {time ? <TextWidget text={`آخرین قیمت دریافتی: ${time}`} style={{ fontSize: 9, color: MUTED, marginTop: 6 }} /> : blank}
    </FlexWidget>
  );
}

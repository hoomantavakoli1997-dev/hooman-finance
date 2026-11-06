import React, { useCallback, useEffect, useRef } from 'react';
import { BackHandler, Platform, StatusBar, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import appHtml from './src/native/appHtml';

/**
 * نسخه‌ی اولیه‌ی اندروید: همان رابط و همان هسته‌ی محاسباتی (src/core) داخل WebView.
 * - داده‌ها در localStorage وب‌ویو ذخیره می‌شود و با بستن برنامه می‌ماند.
 * - درخواست قیمت (TGJU) از طریق fetch بومی انجام می‌شود تا محدودیت CORS مرورگر وجود نداشته باشد.
 */
const TGJU_HOST = 'https://call.tgju.org/';

export default function App() {
  const web = useRef<WebView>(null);

  const reply = useCallback((id: string, ok: boolean, status: number, body: string, err: string) => {
    const esc = (v: unknown) => JSON.stringify(v).split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
    web.current?.injectJavaScript(
      `window.__bridgeReply && window.__bridgeReply(${esc(id)}, ${ok}, ${status}, ${esc(body)}, ${esc(err)}); true;`,
    );
  }, []);

  const onMessage = useCallback(
    async (ev: WebViewMessageEvent) => {
      let msg: { type?: string; id?: string; url?: string };
      try {
        msg = JSON.parse(ev.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'exit') {
        BackHandler.exitApp();
        return;
      }
      if (msg.type === 'fetch' && msg.id && msg.url) {
        // فقط منبع قیمت مجاز است
        if (!msg.url.startsWith(TGJU_HOST)) {
          reply(msg.id, false, 0, '', 'این آدرس مجاز نیست.');
          return;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
          const res = await fetch(msg.url, { signal: ctrl.signal });
          const text = await res.text();
          reply(msg.id, res.ok, res.status, text, '');
        } catch {
          reply(msg.id, false, 0, '', 'اتصال به منبع قیمت برقرار نشد. اینترنت را بررسی کنید.');
        } finally {
          clearTimeout(timer);
        }
      }
    },
    [reply],
  );

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      web.current?.injectJavaScript('window.__hwBack && window.__hwBack(); true;');
      return true;
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#0b1f3a' }}>
      <StatusBar barStyle="light-content" backgroundColor="#0b1f3a" />
      <WebView
        ref={web}
        originWhitelist={['*']}
        source={{ html: appHtml, baseUrl: 'https://hooman-finance.app/' }}
        javaScriptEnabled
        domStorageEnabled
        onMessage={onMessage}
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        overScrollMode="never"
        style={{ flex: 1, backgroundColor: 'transparent' }}
      />
    </View>
  );
}

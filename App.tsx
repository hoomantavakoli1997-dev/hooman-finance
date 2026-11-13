import React, { useCallback, useEffect, useRef } from 'react';
import { BackHandler, Linking, Platform, StatusBar, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import appHtml from './src/native/appHtml';

/**
 * نسخه‌ی اولیه‌ی اندروید: همان رابط و همان هسته‌ی محاسباتی (src/core) داخل WebView.
 * - داده‌ها در localStorage وب‌ویو ذخیره می‌شود و با بستن برنامه می‌ماند.
 * - درخواست قیمت (TGJU) از طریق fetch بومی انجام می‌شود تا محدودیت CORS مرورگر وجود نداشته باشد.
 */
const TGJU_HOST = 'https://call.tgju.org/';
/** فقط این آدرس‌ها برای دریافت قیمت مجازند */
const ALLOWED_FETCH = [TGJU_HOST, 'https://cdn.tsetmc.com/api/'];
/** مخزنی که نسخه‌های APK در بخش Releases آن منتشر می‌شود (باید عمومی باشد) */
const UPDATE_REPO = 'hoomantavakoli1997-dev/hooman-finance';
/** شماره‌ی ساخت همین نسخه؛ هنگام ساخت در GitHub Actions در app.json قرار می‌گیرد */
const BUILD = Number((Constants.expoConfig?.extra as { build?: number } | undefined)?.build ?? 0);

export default function App() {
  const web = useRef<WebView>(null);

  const reply = useCallback((id: string, ok: boolean, status: number, body: string, err: string) => {
    const esc = (v: unknown) => JSON.stringify(v).split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
    web.current?.injectJavaScript(
      `window.__bridgeReply && window.__bridgeReply(${esc(id)}, ${ok}, ${status}, ${esc(body)}, ${esc(err)}); true;`,
    );
  }, []);

  const call = useCallback((fn: string, ...args: unknown[]) => {
    const esc = (v: unknown) => JSON.stringify(v).split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
    web.current?.injectJavaScript(`window.${fn} && window.${fn}(${args.map(esc).join(',')}); true;`);
  }, []);

  const checkUpdate = useCallback(async () => {
    try {
      const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (res.status === 404) {
        call('__updateReply', { ok: false, current: BUILD, latest: 0, url: '', size: 0, notes: '', error: 'نسخه‌ی منتشرشده‌ای پیدا نشد (مخزن باید عمومی باشد).' });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const rel = (await res.json()) as {
        tag_name: string; body?: string;
        assets: { name: string; size: number; browser_download_url: string }[];
      };
      const latest = Number(/(\d+)\s*$/.exec(rel.tag_name)?.[1] ?? 0);
      const asset = rel.assets.find((x) => x.name.endsWith('.apk'));
      call('__updateReply', {
        ok: true, current: BUILD, latest, url: asset?.browser_download_url ?? '', size: asset?.size ?? 0,
        notes: rel.body ?? '', error: '',
      });
    } catch {
      call('__updateReply', { ok: false, current: BUILD, latest: 0, url: '', size: 0, notes: '', error: 'بررسی نسخه‌ی جدید انجام نشد. اینترنت را بررسی کنید.' });
    }
  }, [call]);

  const installUpdate = useCallback(
    async (url: string) => {
      if (!url.startsWith(`https://github.com/${UPDATE_REPO}/releases/download/`)) {
        call('__updateState', 'error', 'آدرس به‌روزرسانی معتبر نیست.');
        return;
      }
      try {
        const target = `${FileSystem.cacheDirectory}hooman-finance-update.apk`;
        await FileSystem.deleteAsync(target, { idempotent: true });
        let lastPct = -1;
        const dl = FileSystem.createDownloadResumable(url, target, {}, (p) => {
          const pct = p.totalBytesExpectedToWrite > 0 ? Math.floor((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100) : 0;
          if (pct !== lastPct) {
            lastPct = pct;
            call('__updateProgress', pct);
          }
        });
        const out = await dl.downloadAsync();
        if (!out || out.status !== 200) throw new Error('download');
        const uri = await FileSystem.getContentUriAsync(out.uri);
        call('__updateState', 'installing', '');
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: uri,
          flags: 1,
          type: 'application/vnd.android.package-archive',
        });
      } catch {
        call('__updateState', 'error', 'دانلود یا نصب انجام نشد. اینترنت و فضای گوشی را بررسی کنید.');
      }
    },
    [call],
  );

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
      if (msg.type === 'open' && msg.url) {
        // فقط پیوند پشتیبانی (تلگرام) از داخل برنامه باز می‌شود
        if (msg.url.startsWith('https://t.me/')) void Linking.openURL(msg.url).catch(() => undefined);
        return;
      }
      if (msg.type === 'update-check') {
        void checkUpdate();
        return;
      }
      if (msg.type === 'update-install' && msg.url) {
        void installUpdate(msg.url);
        return;
      }
      if (msg.type === 'fetch' && msg.id && msg.url) {
        // فقط منبع قیمت مجاز است
        if (!ALLOWED_FETCH.some((h) => msg.url!.startsWith(h))) {
          reply(msg.id, false, 0, '', 'این آدرس مجاز نیست.');
          return;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
          // بعضی سرورها (مثل بورس) درخواست بدون هدر مرورگر را رد می‌کنند
          const res = await fetch(msg.url, {
            signal: ctrl.signal,
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8',
              'User-Agent':
                'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            },
          });
          const text = await res.text();
          reply(msg.id, res.ok, res.status, text, '');
        } catch (e) {
          const why = ctrl.signal.aborted ? 'پاسخی نیامد (۱۵ ثانیه)' : String((e as Error)?.message ?? e).slice(0, 120);
          reply(msg.id, false, 0, '', `اتصال به منبع قیمت برقرار نشد (${why}).`);
        } finally {
          clearTimeout(timer);
        }
      }
    },
    [reply, checkUpdate, installUpdate],
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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Animated, BackHandler, Easing, Linking, Platform, StatusBar, Text, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import * as IntentLauncher from 'expo-intent-launcher';
import appHtml from './src/native/appHtml';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { renderMarketWidget, writeWidgetConfig } from './widget/widget-task-handler';
import { sanitizeConfig } from './src/native/widgetData';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { checkDatabaseIntegrity, initializeDatabase, readSnapshot, writeSnapshot, type DaraSnapshot } from './src/native/sqlite';

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

const TSETMC_HOST = 'https://cdn.tsetmc.com/';
const NOTE_CHANNEL = 'reminders';
// اعلان حتی وقتی برنامه باز است نمایش داده شود
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});
async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(NOTE_CHANNEL, {
    name: 'یادآورها',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 150, 250],
  });
}
/**
 * کلید رمزنگاری اطلاعات: ۲۵۶ بیت تصادفی، نگه‌داری‌شده در Android Keystore (از طریق SecureStore).
 * اگر ساخته یا خوانده نشود null برمی‌گردد و برنامه مثل قبل بدون رمزنگاری کار می‌کند.
 */
const DATA_KEY_NAME = 'dara-data-key-v1';
async function loadDataKey(): Promise<string | null> {
  try {
    const old = await SecureStore.getItemAsync(DATA_KEY_NAME);
    if (old && /^[0-9a-f]{64}$/.test(old)) return old;
    const bytes = await Crypto.getRandomBytesAsync(32);
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(DATA_KEY_NAME, hex);
    return (await SecureStore.getItemAsync(DATA_KEY_NAME)) === hex ? hex : null;
  } catch {
    return null;
  }
}
interface WvJob { id: string; url: string }

export default function App() {
  const web = useRef<WebView>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [sqliteSnapshot, setSqliteSnapshot] = useState<string | null>(null);
  const [dataKey, setDataKey] = useState<string | null>(null);
  const sqliteWriteQueue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const k = await loadDataKey();
        if (active) setDataKey(k);
        await initializeDatabase();
        if (await checkDatabaseIntegrity()) {
          const snapshot = await readSnapshot();
          if (active && snapshot) setSqliteSnapshot(JSON.stringify(snapshot));
        }
      } catch {
        // SQLite is a secondary mirror in this rollout; legacy WebView storage remains available.
      } finally {
        if (active) setStorageReady(true);
      }
    })();
    return () => { active = false; };
  }, []);
  const [showBrandIntro, setShowBrandIntro] = useState(true);
  const introScale = useRef(new Animated.Value(0.78)).current;
  const introOpacity = useRef(new Animated.Value(1)).current;
  const introSpin = useRef(new Animated.Value(0)).current;
  const introOrbit = useRef(new Animated.Value(0)).current;
  const introPulse = useRef(new Animated.Value(1)).current;
  const introTextY = useRef(new Animated.Value(14)).current;
  useEffect(() => {
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(introPulse, { toValue: 1.055, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(introPulse, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    Animated.parallel([
      Animated.spring(introScale, { toValue: 1, friction: 6, tension: 48, useNativeDriver: true }),
      Animated.timing(introSpin, { toValue: 1, duration: 2100, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(introOrbit, { toValue: 1, duration: 2600, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(introTextY, { toValue: 0, duration: 700, delay: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    pulse.start();
    const fade = setTimeout(() => {
      pulse.stop();
      Animated.timing(introOpacity, { toValue: 0, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: true })
        .start(({ finished }) => { if (finished) setShowBrandIntro(false); });
    }, 2550);
    return () => { clearTimeout(fade); pulse.stop(); };
  }, [introOpacity, introOrbit, introPulse, introScale, introSpin, introTextY]);
  // مرورگر نامرئی برای بورس: اگر fetch بومی به سرور بورس نرسید (مثلاً به‌خاطر گواهی ناقص سرور)،
  // همان آدرس را مثل مرورگر باز می‌کنیم و متن صفحه را برمی‌داریم. درخواست‌ها یکی‌یکی انجام می‌شود.
  const [job, setJob] = useState<WvJob | null>(null);
  const jobRef = useRef<WvJob | null>(null);
  const queue = useRef<WvJob[]>([]);

  const reply = useCallback((id: string, ok: boolean, status: number, body: string, err: string) => {
    const esc = (v: unknown) => JSON.stringify(v).split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
    web.current?.injectJavaScript(
      `window.__bridgeReply && window.__bridgeReply(${esc(id)}, ${ok}, ${status}, ${esc(body)}, ${esc(err)}); true;`,
    );
  }, []);

  // وضعیت برنامه (پیش‌زمینه/پس‌زمینه) برای قفل خودکار
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => web.current?.injectJavaScript(`window.__appState && window.__appState(${JSON.stringify(st)}); true;`));
    return () => sub.remove();
  }, []);

  const nextJob = useCallback(() => {
    const n = queue.current.shift() ?? null;
    jobRef.current = n;
    setJob(n);
  }, []);

  const finishJob = useCallback(
    (id: string, ok: boolean, status: number, body: string, err: string) => {
      if (jobRef.current?.id !== id) return;
      reply(id, ok, status, body, err);
      nextJob();
    },
    [reply, nextJob],
  );

  const viaWebView = useCallback((id: string, url: string) => {
    const j = { id, url };
    if (jobRef.current) {
      queue.current.push(j);
    } else {
      jobRef.current = j;
      setJob(j);
    }
  }, []);

  useEffect(() => {
    if (!job) return;
    const t = setTimeout(() => finishJob(job.id, false, 0, '', 'اتصال به بورس برقرار نشد (پاسخی نیامد، ۲۰ ثانیه).'), 20000);
    return () => clearTimeout(t);
  }, [job, finishJob]);

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
      let msg: { type?: string; id?: string; url?: string; name?: string; text?: string; purpose?: string; title?: string; body?: string; ask?: boolean; snapshot?: string; ack?: number; widget?: unknown; mime?: string; notes?: { id: string; title: string; body: string; at: number }[] };
      try {
        msg = JSON.parse(ev.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'sqlite-snapshot' && typeof msg.snapshot === 'string') {
        // Serialize writes so rapid edits cannot land in SQLite out of order.
        sqliteWriteQueue.current = sqliteWriteQueue.current.then(async () => {
          const snapshot = JSON.parse(msg.snapshot!) as DaraSnapshot;
          await writeSnapshot(snapshot);
          if (typeof msg.ack === 'number') call('__encAck', msg.ack, true);
        }).catch(() => {
          // Keep localStorage intact; the UI must remain usable if SQLite is unavailable.
          if (typeof msg.ack === 'number') call('__encAck', msg.ack, false);
        });
        return;
      }
      if (msg.type === 'widget-config') {
        // پیکربندی و آخرین قیمت‌ها برای ویجت؛ ورودی وب‌ویو نامطمئن است و اعتبارسنجی می‌شود
        void (async () => {
          try {
            const cfg = sanitizeConfig(msg.widget);
            if (!cfg) return;
            await writeWidgetConfig(cfg);
            await requestWidgetUpdate({ widgetName: 'DaraMarket', renderWidget: () => renderMarketWidget(cfg), widgetNotFound: () => {} });
          } catch {
            // نبودن ویجت روی صفحه یا خطای نوشتن نباید روی برنامه اثر بگذارد
          }
        })();
        return;
      }
      if (msg.type === 'exit') {
        BackHandler.exitApp();
        return;
      }
      if (msg.type === 'notify-perm') {
        void (async () => {
          try {
            await ensureChannel();
            let st = await Notifications.getPermissionsAsync();
            if (!st.granted && msg.ask && st.canAskAgain) st = await Notifications.requestPermissionsAsync();
            call('__notifyPerm', { ok: st.granted, canAsk: st.canAskAgain });
          } catch {
            call('__notifyPerm', { ok: false, canAsk: false });
          }
        })();
        return;
      }
      if (msg.type === 'notify-sync' && Array.isArray(msg.notes)) {
        // فهرست اعلان‌های آینده را کامل جایگزین می‌کنیم تا چیز تکراری یا قدیمی نماند
        const notes = msg.notes;
        void (async () => {
          try {
            const st = await Notifications.getPermissionsAsync();
            await Notifications.cancelAllScheduledNotificationsAsync();
            if (!st.granted) return;
            await ensureChannel();
            for (const n of notes.slice(0, 48)) {
              await Notifications.scheduleNotificationAsync({
                identifier: n.id,
                content: { title: String(n.title).slice(0, 80), body: String(n.body).slice(0, 160) },
                trigger: { date: new Date(n.at), channelId: NOTE_CHANNEL } as never,
              });
            }
          } catch {
            /* اعلان زمان‌بندی نشد؛ یادآورها داخل برنامه همچنان دیده می‌شوند */
          }
        })();
        return;
      }
      if (msg.type === 'notify-now' && msg.title) {
        void (async () => {
          try {
            const st = await Notifications.getPermissionsAsync();
            if (!st.granted) return;
            await ensureChannel();
            await Notifications.scheduleNotificationAsync({
              content: { title: String(msg.title).slice(0, 80), body: String(msg.body ?? '').slice(0, 160) },
              trigger: { channelId: NOTE_CHANNEL } as never,
            });
          } catch {
            /* ignore */
          }
        })();
        return;
      }
      if (msg.type === 'bio-check') {
        void (async () => {
          try {
            const ok = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
            call('__bioAvail', { ok });
          } catch {
            call('__bioAvail', { ok: false });
          }
        })();
        return;
      }
      if (msg.type === 'bio-auth') {
        const purpose = msg.purpose;
        void (async () => {
          try {
            const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'باز کردن دارا', cancelLabel: 'استفاده از رمز', disableDeviceFallback: true });
            call('__bioReply', { ok: r.success, purpose });
          } catch {
            call('__bioReply', { ok: false, purpose });
          }
        })();
        return;
      }
      if (msg.type === 'share-file' && typeof msg.text === 'string' && typeof msg.name === 'string') {
        // فایل پشتیبان رمزدار را می‌نویسد و منوی اشتراک‌گذاری اندروید (جیمیل، Drive، …) را باز می‌کند
        void (async () => {
          try {
            const uri = `${FileSystem.cacheDirectory ?? ''}${msg.name.replace(/[^\w.\-]/g, '_')}`;
            await FileSystem.writeAsStringAsync(uri, msg.text as string, { encoding: FileSystem.EncodingType.UTF8 });
            if (!(await Sharing.isAvailableAsync())) throw new Error('اشتراک‌گذاری در این دستگاه نیست.');
            const csv = msg.mime === 'text/csv';
            await Sharing.shareAsync(uri, { mimeType: csv ? 'text/csv' : 'application/octet-stream', dialogTitle: csv ? 'ارسال گزارش' : 'ارسال فایل پشتیبان' });
            call('__shareReply', { ok: true });
          } catch (e) {
            call('__shareReply', { ok: false, error: String((e as Error)?.message ?? e).slice(0, 120) });
          }
        })();
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
          if (msg.url.startsWith(TSETMC_HOST)) {
            viaWebView(msg.id, msg.url);
            return;
          }
          const why = ctrl.signal.aborted ? 'پاسخی نیامد (۱۵ ثانیه)' : String((e as Error)?.message ?? e).slice(0, 120);
          reply(msg.id, false, 0, '', `اتصال به منبع قیمت برقرار نشد (${why}).`);
        } finally {
          clearTimeout(timer);
        }
      }
    },
    [reply, call, checkUpdate, installUpdate, viaWebView],
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
      {storageReady ? (
      <WebView
        ref={web}
        originWhitelist={['*']}
        injectedJavaScriptBeforeContentLoaded={`window.__APP_BUILD = ${BUILD}; window.__DARA_SQLITE_SNAPSHOT = ${JSON.stringify(sqliteSnapshot)}; window.__DARA_KEY = ${JSON.stringify(dataKey)}; true;`}
        source={{ html: appHtml, baseUrl: 'https://hooman-finance.app/' }}
        javaScriptEnabled
        domStorageEnabled
        onMessage={onMessage}
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        overScrollMode="never"
        style={{ flex: 1, backgroundColor: 'transparent' }}
      />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b1f3a' }}>
          <Text style={{ color: '#d7e8ef', fontSize: 14 }}>در حال آماده‌سازی اطلاعات دارا…</Text>
        </View>
      )}
      {showBrandIntro && (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, elevation: 50, overflow: 'hidden', backgroundColor: '#081a30', alignItems: 'center', justifyContent: 'center', opacity: introOpacity }}>
          <View style={{ position: 'absolute', width: 330, height: 330, borderRadius: 165, borderWidth: 1, borderColor: 'rgba(37,190,190,0.07)' }} />
          <View style={{ position: 'absolute', width: 265, height: 265, borderRadius: 133, borderWidth: 1, borderColor: 'rgba(226,189,104,0.06)' }} />
          <View style={{ position: 'absolute', width: 205, height: 205, borderRadius: 103, backgroundColor: 'rgba(18,179,176,0.035)' }} />
          <Animated.View style={{ width: 174, height: 174, alignItems: 'center', justifyContent: 'center', transform: [{ scale: introScale }] }}>
            <Animated.View style={{ position: 'absolute', width: 164, height: 164, borderRadius: 82, borderWidth: 1.5, borderColor: 'rgba(44,210,205,0.5)', borderRightColor: 'rgba(44,210,205,0.08)', transform: [{ rotate: introSpin.interpolate({ inputRange: [0, 1], outputRange: ['-115deg', '245deg'] }) }] }} />
            <Animated.View style={{ position: 'absolute', width: 138, height: 138, borderRadius: 69, borderWidth: 1, borderColor: 'rgba(226,189,104,0.34)', borderLeftColor: 'rgba(226,189,104,0.05)', transform: [{ rotate: introSpin.interpolate({ inputRange: [0, 1], outputRange: ['100deg', '-260deg'] }) }] }} />
            <Animated.View style={{ position: 'absolute', width: 174, height: 174, transform: [{ rotate: introOrbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
              <View style={{ position: 'absolute', top: 3, left: 81, width: 11, height: 11, borderRadius: 6, backgroundColor: '#f0c66e', shadowColor: '#f0c66e', shadowOpacity: 0.9, shadowRadius: 9, elevation: 8 }} />
            </Animated.View>
            <Animated.View style={{ width: 102, height: 102, borderRadius: 32, backgroundColor: '#103958', borderWidth: 1.5, borderColor: 'rgba(111,231,224,0.42)', alignItems: 'center', justifyContent: 'center', transform: [{ scale: introPulse }], shadowColor: '#16c5bd', shadowOpacity: 0.34, shadowRadius: 28, elevation: 16 }}>
              <View style={{ position: 'absolute', top: 17, right: 18, width: 9, height: 9, borderRadius: 5, backgroundColor: '#e7bd68' }} />
              <Text style={{ color: '#f5d78d', fontSize: 61, lineHeight: 72, fontWeight: '800', includeFontPadding: false, letterSpacing: -4 }}>D</Text>
              <View style={{ position: 'absolute', bottom: 16, width: 34, height: 3, borderRadius: 2, backgroundColor: '#28c7bd' }} />
            </Animated.View>
          </Animated.View>
          <Animated.View style={{ opacity: introOpacity, alignItems: 'center', marginTop: 27, transform: [{ translateY: introTextY }] }}>
            <Text style={{ color: '#f7f9fc', fontSize: 34, fontWeight: '800', letterSpacing: 0.2 }}>دارا</Text>
            <Text style={{ color: '#e7bd68', fontSize: 12, fontWeight: '800', letterSpacing: 7, marginTop: 4 }}>D A R A</Text>
            <View style={{ width: 38, height: 2, borderRadius: 2, backgroundColor: '#20bdb5', marginTop: 18, marginBottom: 13 }} />
            <Text style={{ color: '#a9deda', fontSize: 14, fontWeight: '600' }}>همه دارایی‌هایت، یک‌جا.</Text>
            <Text style={{ color: 'rgba(195,215,225,0.52)', fontSize: 10, marginTop: 36, letterSpacing: 1 }}>مدیریت هوشمند دارایی‌ها</Text>
          </Animated.View>
        </Animated.View>
      )}
      {job && (
        <View pointerEvents="none" style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}>
          <WebView
            key={job.id}
            source={{ uri: job.url }}
            javaScriptEnabled
            injectedJavaScript={"(function(){var t=document.body?document.body.innerText:'';window.ReactNativeWebView.postMessage(t);})();true;"}
            onMessage={(e: WebViewMessageEvent) => finishJob(job.id, true, 200, e.nativeEvent.data, '')}
            onError={(e) => finishJob(job.id, false, 0, '', `اتصال به بورس برقرار نشد (${String(e.nativeEvent.description).slice(0, 100)}).`)}
            onHttpError={(e) => finishJob(job.id, false, e.nativeEvent.statusCode, '', `پاسخ نامعتبر از سرور بورس (کد ${e.nativeEvent.statusCode}).`)}
          />
        </View>
      )}
    </View>
  );
}

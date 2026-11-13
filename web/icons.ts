import type { Asset } from '../src/core/types';
import { CASH_ID } from '../src/core/types';

/**
 * آیکون دارایی‌ها: همه با SVG داخل برنامه کشیده شده‌اند (بدون اینترنت کار می‌کنند).
 * پرچم‌ها نمادهای ملی‌اند. سکه‌ها طرح اصیل خود برنامه‌اند، نه لوگوی شرکت‌ها.
 */

type Kind =
  | { t: 'cash' } | { t: 'gold'; label?: string } | { t: 'silver' } | { t: 'stable' } | { t: 'crypto' }
  | { t: 'stock' } | { t: 'flag'; code: string } | { t: 'currency' } | { t: 'letter'; ch: string } | { t: 'ticker'; text: string } | { t: 'brand'; slug: string } | { t: 'people' };

export function iconKind(a: { id: string; name: string; unit?: string; kind?: Asset['kind']; priceKeys?: Record<string, string> }): Kind {
  if (a.id === CASH_ID || a.id === 'cash') return { t: 'cash' };
  const k = (a.priceKeys?.tgju ?? a.id).toLowerCase().replace(/^m_/, '');
  if (a.id === 'gold' || k === 'geram18') return { t: 'gold', label: '۱۸' };
  if (/silver|nogre|noghre/.test(k)) return { t: 'silver' };
  if (/geram24|sekee|sekeb|sekke|nim|rob|mesghal|gold|abshodeh|coin/.test(k)) return { t: 'gold' };
  if (a.id === 'usdt' || /usdt|tether/.test(k)) return { t: 'brand', slug: 'tether' };
  if (a.id === 'usd' || k === 'price_dollar_rl') return { t: 'flag', code: 'us' };
  const f = /^price_(eur|gbp|jpy|try|aed|cny)/.exec(k);
  if (f) return { t: 'flag', code: f[1] };
  if (a.kind === 'crypto' || /^crypto/.test(k)) {
    const slug = k.replace(/^crypto[-_]/, '').replace(/-(irr|irc)$/, '');
    const known = ['bitcoin','ethereum','ripple','solana','dogecoin','tron','litecoin','toncoin','usd-coin'];
    return { t: 'brand', slug: known.includes(slug) ? slug : 'crypto' };
  }
  if (a.priceKeys?.tsetmc || (a.kind === 'custom' && a.unit === 'سهم')) return { t: 'ticker', text: [...a.name.trim()].slice(0, 2).join('') || 'سهم' };
  if (a.kind === 'currency') return { t: 'currency' };
  return { t: 'letter', ch: [...a.name.trim()][0] ?? '؟' };
}

const wrap = (inner: string, bg = 'none') =>
  `<svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true" focusable="false"><rect width="40" height="40" fill="${bg}"/>${inner}</svg>`;

const circle = (inner: string, id: string) =>
  `<defs><clipPath id="${id}"><circle cx="20" cy="20" r="16"/></clipPath></defs><g clip-path="url(#${id})">${inner}</g><circle cx="20" cy="20" r="16" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="1"/>`;

const star = (cx: number, cy: number, r: number, fill: string) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const rad = (i % 2 === 0 ? r : r * 0.4);
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
  });
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
};

function flag(code: string): string {
  switch (code) {
    case 'us': {
      let s = '<rect width="40" height="40" fill="#fff"/>';
      for (let i = 0; i < 7; i++) s += `<rect y="${(4 + i * 4.6).toFixed(2)}" width="40" height="2.3" fill="#c8323c"/>`;
      s += '<rect x="4" y="4" width="19" height="17.5" fill="#2b3a7a"/>';
      for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) s += `<circle cx="${(7.2 + c * 3.6).toFixed(1)}" cy="${(7.2 + r * 3.9).toFixed(1)}" r="0.9" fill="#fff"/>`;
      return wrap(circle(s, 'cp-us'));
    }
    case 'eur': {
      let s = '<rect width="40" height="40" fill="#2a4a9c"/>';
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        s += `<circle cx="${(20 + 8.5 * Math.cos(a)).toFixed(2)}" cy="${(20 + 8.5 * Math.sin(a)).toFixed(2)}" r="1.4" fill="#f4c20d"/>`;
      }
      return wrap(circle(s, 'cp-eu'));
    }
    case 'gbp':
      return wrap(circle(
        '<rect width="40" height="40" fill="#1f3a7a"/><path d="M0 0L40 40M40 0L0 40" stroke="#fff" stroke-width="7"/><path d="M0 0L40 40M40 0L0 40" stroke="#c8323c" stroke-width="2.6"/><path d="M20 0V40M0 20H40" stroke="#fff" stroke-width="10"/><path d="M20 0V40M0 20H40" stroke="#c8323c" stroke-width="6"/>',
        'cp-gb'));
    case 'jpy':
      return wrap(circle('<rect width="40" height="40" fill="#fff"/><circle cx="20" cy="20" r="7" fill="#c8323c"/>', 'cp-jp'));
    case 'try':
      return wrap(circle(`<rect width="40" height="40" fill="#d62f2f"/><circle cx="17" cy="20" r="7" fill="#fff"/><circle cx="19" cy="20" r="5.6" fill="#d62f2f"/>${star(24, 20, 3.6, '#fff')}`, 'cp-tr'));
    case 'aed':
      return wrap(circle('<rect width="40" height="13.4" y="4" fill="#00732f"/><rect width="40" height="13.4" y="13.3" fill="#fff"/><rect width="40" height="13.4" y="22.6" fill="#111"/><rect width="12" height="40" fill="#c8102e"/>', 'cp-ae'));
    case 'cny':
      return wrap(circle(`<rect width="40" height="40" fill="#d62f2f"/>${star(12, 13, 5, '#ffd84a')}${star(22, 7, 1.7, '#ffd84a')}${star(26, 12, 1.7, '#ffd84a')}${star(26, 18, 1.7, '#ffd84a')}${star(22, 23, 1.7, '#ffd84a')}`, 'cp-cn'));
    default:
      return wrap('');
  }
}

const coin = (rim: string, face: string, ink: string, label = '', extra = '') =>
  wrap(`<circle cx="20" cy="20" r="16" fill="${rim}"/><circle cx="20" cy="20" r="12.8" fill="${face}"/>
    <path d="M10.5 15.5A11 11 0 0 1 22 9" stroke="rgba(255,255,255,.55)" stroke-width="1.8" fill="none" stroke-linecap="round"/>${extra}
    ${label ? `<text x="20" y="24.6" text-anchor="middle" font-size="13" font-weight="800" fill="${ink}" font-family="Vazirmatn,Tahoma,sans-serif">${label}</text>` : ''}`);

function brandIcon(slug: string): string {
  const brands: Record<string, { bg: string; mark: string; size: number }> = {
    tether: { bg: '#26a17b', mark: '₮', size: 23 },
    bitcoin: { bg: '#f7931a', mark: '₿', size: 23 },
    ethereum: { bg: '#627eea', mark: '◆', size: 23 },
    ripple: { bg: '#23292f', mark: 'X', size: 22 },
    solana: { bg: '#171b2b', mark: '≋', size: 27 },
    dogecoin: { bg: '#c2a633', mark: 'Ð', size: 23 },
    tron: { bg: '#e84142', mark: 'T', size: 23 },
    litecoin: { bg: '#345d9d', mark: 'Ł', size: 23 },
    toncoin: { bg: '#0098ea', mark: 'TON', size: 11 },
    'usd-coin': { bg: '#2775ca', mark: '
  switch (k.t) {
    case 'cash':
      return wrap('<rect x="5" y="11" width="30" height="18" rx="3" fill="#3aa876"/><rect x="5" y="11" width="30" height="18" rx="3" fill="none" stroke="#1f7a52" stroke-width="1.4"/><circle cx="20" cy="20" r="4.6" fill="#bff0d6"/><circle cx="10.5" cy="20" r="1.4" fill="#bff0d6"/><circle cx="29.5" cy="20" r="1.4" fill="#bff0d6"/>');
    case 'gold':
      return coin('#b9861b', '#f2c53d', '#7a5200', k.label ?? '', k.label ? '' : '<circle cx="20" cy="20" r="7" fill="none" stroke="#c8981f" stroke-width="1.4"/>');
    case 'silver':
      return coin('#7d8791', '#d5dbe1', '#4b535b', '', '<circle cx="20" cy="20" r="7" fill="none" stroke="#9aa4ad" stroke-width="1.4"/>');
    case 'stable':
      return wrap('<circle cx="20" cy="20" r="16" fill="#26a17b"/><path d="M10 12h20M20 12v17M13 17h14" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>');
    case 'crypto':
      return wrap('<circle cx="20" cy="20" r="16" fill="#5a4bd1"/><path d="M20 9l9 5.2v10.4L20 30l-9-5.4V14.2z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><circle cx="20" cy="19.5" r="3" fill="#fff"/>');
    case 'brand':
      return brandIcon(k.slug);
    case 'stock':
      return wrap('<rect x="4" y="4" width="32" height="32" rx="8" fill="#0f8f8a"/><rect x="10" y="21" width="5" height="9" rx="1" fill="#fff"/><rect x="17.5" y="15" width="5" height="15" rx="1" fill="#fff"/><rect x="25" y="9" width="5" height="21" rx="1" fill="#bff5f1"/>');
    case 'flag':
      return flag(k.code);
    case 'currency':
      return coin('#5c6b82', '#9fb0c6', '#243247', '¤');
    case 'ticker':
      return wrap(`<rect x="3" y="3" width="34" height="34" rx="10" fill="#315b80"/><text x="20" y="25" text-anchor="middle" font-size="${k.text.length > 1 ? 13 : 18}" font-weight="800" fill="#fff" font-family="Vazirmatn,Tahoma,sans-serif">${k.text.replace(/[<>&]/g, '')}</text>`);
    case 'people':
      return wrap('<circle cx="20" cy="15" r="6" fill="#6f8fb0"/><path d="M8 33c1.5-7 6-10 12-10s10.500 3 12 10z" fill="#6f8fb0"/>');
    default:
      return wrap(`<circle cx="20" cy="20" r="16" fill="#31506f"/><text x="20" y="26" text-anchor="middle" font-size="17" font-weight="800" fill="#fff" font-family="Vazirmatn,Tahoma,sans-serif">${k.ch.replace(/[<>&]/g, '')}</text>`);
  }
}

export const assetIcon = (a: Parameters<typeof iconKind>[0]): string => `<span class="ico">${iconSvg(iconKind(a))}</span>`;

export function marketIcon(key: string, category: string, title: string): string {
  const k = key.toLowerCase();
  if (category === 'gold') return iconSvg({ t: 'gold', label: /18|geram18/.test(k) ? '۱۸' : '' });
  if (category === 'metal') return iconSvg({ t: /silver|noghre/.test(k) ? 'silver' : 'gold' });
  if (category === 'currency') {
    const code = k === 'price_dollar_rl' ? 'us' : /^price_([a-z]{3})$/.exec(k)?.[1] ?? '';
    const flagCodes: Record<string, string> = { usd: 'us', eur: 'eur', gbp: 'gbp', jpy: 'jpy', try: 'try', aed: 'aed', cny: 'cny' };
    return iconSvg(flagCodes[code] ? { t: 'flag', code: flagCodes[code] } : { t: 'currency' });
  }
  if (category === 'crypto') {
    const slug = k.replace(/^crypto[-_]/, '').replace(/-(irr|irc)$/, '');
    const known = ['tether','bitcoin','ethereum','ripple','solana','dogecoin','tron','litecoin','toncoin','usd-coin'];
    return iconSvg({ t: 'brand', slug: known.includes(slug) ? slug : 'crypto' });
  }
  return iconSvg({ t: 'ticker', text: [...title].filter((c) => c.trim()).slice(0, 2).join('') || '•' });
}
, size: 23 },
    crypto: { bg: '#5a4bd1', mark: '◆', size: 21 },
  };
  const b = brands[slug] ?? brands.crypto;
  const svg = '<circle cx="20" cy="20" r="17" fill="' + b.bg + '"/>' +
    '<text x="20" y="27" text-anchor="middle" font-size="' + b.size + '" font-weight="800" fill="#fff" font-family="Arial,sans-serif">' + b.mark + '</text>';
  return wrap(svg);
}

export function iconSvg(k: Kind): string {
  switch (k.t) {
    case 'cash':
      return wrap('<rect x="5" y="11" width="30" height="18" rx="3" fill="#3aa876"/><rect x="5" y="11" width="30" height="18" rx="3" fill="none" stroke="#1f7a52" stroke-width="1.4"/><circle cx="20" cy="20" r="4.6" fill="#bff0d6"/><circle cx="10.5" cy="20" r="1.4" fill="#bff0d6"/><circle cx="29.5" cy="20" r="1.4" fill="#bff0d6"/>');
    case 'gold':
      return coin('#b9861b', '#f2c53d', '#7a5200', k.label ?? '', k.label ? '' : '<circle cx="20" cy="20" r="7" fill="none" stroke="#c8981f" stroke-width="1.4"/>');
    case 'silver':
      return coin('#7d8791', '#d5dbe1', '#4b535b', '', '<circle cx="20" cy="20" r="7" fill="none" stroke="#9aa4ad" stroke-width="1.4"/>');
    case 'stable':
      return wrap('<circle cx="20" cy="20" r="16" fill="#26a17b"/><path d="M10 12h20M20 12v17M13 17h14" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>');
    case 'crypto':
      return wrap('<circle cx="20" cy="20" r="16" fill="#5a4bd1"/><path d="M20 9l9 5.2v10.4L20 30l-9-5.4V14.2z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><circle cx="20" cy="19.5" r="3" fill="#fff"/>');
    case 'stock':
      return wrap('<rect x="4" y="4" width="32" height="32" rx="8" fill="#0f8f8a"/><rect x="10" y="21" width="5" height="9" rx="1" fill="#fff"/><rect x="17.5" y="15" width="5" height="15" rx="1" fill="#fff"/><rect x="25" y="9" width="5" height="21" rx="1" fill="#bff5f1"/>');
    case 'flag':
      return flag(k.code);
    case 'currency':
      return coin('#5c6b82', '#9fb0c6', '#243247', '¤');
    case 'ticker':
      return wrap(`<rect x="3" y="3" width="34" height="34" rx="10" fill="#315b80"/><text x="20" y="25" text-anchor="middle" font-size="${k.text.length > 1 ? 13 : 18}" font-weight="800" fill="#fff" font-family="Vazirmatn,Tahoma,sans-serif">${k.text.replace(/[<>&]/g, '')}</text>`);
    case 'people':
      return wrap('<circle cx="20" cy="15" r="6" fill="#6f8fb0"/><path d="M8 33c1.5-7 6-10 12-10s10.500 3 12 10z" fill="#6f8fb0"/>');
    default:
      return wrap(`<circle cx="20" cy="20" r="16" fill="#31506f"/><text x="20" y="26" text-anchor="middle" font-size="17" font-weight="800" fill="#fff" font-family="Vazirmatn,Tahoma,sans-serif">${k.ch.replace(/[<>&]/g, '')}</text>`);
  }
}

export const assetIcon = (a: Parameters<typeof iconKind>[0]): string => `<span class="ico">${iconSvg(iconKind(a))}</span>`;

export function marketIcon(key: string, category: string, title: string): string {
  const k = key.toLowerCase();
  if (category === 'gold') return iconSvg({ t: 'gold', label: /18|geram18/.test(k) ? '۱۸' : '' });
  if (category === 'metal') return iconSvg({ t: /silver|noghre/.test(k) ? 'silver' : 'gold' });
  if (category === 'currency') {
    const code = k === 'price_dollar_rl' ? 'us' : /^price_([a-z]{3})$/.exec(k)?.[1] ?? '';
    const flagCodes: Record<string, string> = { usd: 'us', eur: 'eur', gbp: 'gbp', jpy: 'jpy', try: 'try', aed: 'aed', cny: 'cny' };
    return iconSvg(flagCodes[code] ? { t: 'flag', code: flagCodes[code] } : { t: 'currency' });
  }
  if (category === 'crypto') {
    const slug = k.replace(/^crypto[-_]/, '').replace(/-(irr|irc)$/, '');
    const marks: Record<string, string> = { tether: '₮', bitcoin: '₿', ethereum: '◆', ripple: 'X', solana: 'S', dogecoin: 'Ð', tron: 'T', litecoin: 'Ł', toncoin: 'TON', 'usd-coin': 'USDC' };
    return iconSvg({ t: 'ticker', text: marks[slug] ?? [...title].slice(0, 2).join('') });
  }
  return iconSvg({ t: 'ticker', text: [...title].filter((c) => c.trim()).slice(0, 2).join('') || '•' });
}

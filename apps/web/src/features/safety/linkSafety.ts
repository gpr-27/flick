// Is this link worth a warning before it opens? Pure heuristics on the address text only;
// nothing is fetched. "danger" = very likely a trick, "warn" = worth a second look.

export type LinkLevel = 'ok' | 'warn' | 'danger';
export interface LinkAssessment {
  level: LinkLevel;
  reasons: string[];
}

const SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'cutt.ly',
  'rb.gy',
  'shorturl.at',
  'tiny.cc',
  'rebrand.ly',
  'bl.ink',
]);
const ODD_TLDS = new Set([
  'zip',
  'mov',
  'tk',
  'ml',
  'ga',
  'cf',
  'gq',
  'top',
  'xyz',
  'click',
  'country',
  'work',
  'support',
  'loan',
  'men',
  'icu',
  'cam',
]);
const LOGIN_WORDS =
  /(login|log-in|signin|sign-in|verify|account|password|secure|wallet|bank|update-?billing)/i;
const BRANDS = [
  'paypal',
  'google',
  'apple',
  'microsoft',
  'amazon',
  'netflix',
  'facebook',
  'instagram',
  'whatsapp',
  'binance',
];

const isIp = (host: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
  /^\[[0-9a-f:]+\]$/i.test(host) ||
  /^0x[0-9a-f]+$/i.test(host);

export function assessLink(href: string): LinkAssessment {
  const reasons: string[] = [];
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { level: 'ok', reasons };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { level: 'ok', reasons };
  const host = url.hostname.toLowerCase();
  let danger = false;

  if (
    url.username ||
    url.password ||
    url.href
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      ?.includes('@')
  ) {
    reasons.push('The address contains "@", which can hide the real site.');
    danger = true;
  }
  if (isIp(host)) {
    reasons.push('It goes to a raw IP address instead of a website name.');
    danger = true;
  }
  if (host.split('.').some((label) => label.startsWith('xn--'))) {
    reasons.push('The site name uses look-alike (punycode) characters.');
    danger = true;
  }
  if (/[^\p{ASCII}]/u.test(decodeURIComponent(url.href.split('/')[2] ?? ''))) {
    reasons.push('The site name contains unusual characters.');
    danger = true;
  }
  const labels = host.split('.');
  const registrable = labels.slice(-2).join('.');
  if (SHORTENERS.has(registrable))
    reasons.push('It is a shortened link, so the real site is hidden.');
  const tld = labels[labels.length - 1] ?? '';
  if (ODD_TLDS.has(tld)) reasons.push(`The ".${tld}" ending is often used for scams.`);
  if (labels.length > 4) reasons.push('The address has many sub-domains.');
  const brand = BRANDS.find((b) => host.includes(b) && registrable !== `${b}.com`);
  if (brand && registrable.split('.')[0] !== brand) {
    reasons.push(`It mentions "${brand}" but is not the real ${brand} site.`);
    danger = true;
  }
  if (url.protocol === 'http:' && LOGIN_WORDS.test(url.pathname + url.search + host)) {
    reasons.push('It is not encrypted (http) and asks about login or accounts.');
    danger = true;
  }
  if (reasons.length === 0) return { level: 'ok', reasons };
  return { level: danger ? 'danger' : 'warn', reasons };
}

/** Pure helpers: escaping, wording and dates. None of these touch the page or its state. */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function toTitleCase(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/(^|[^a-zA-Z0-9'])([a-z])/g, (_m, p1: string, p2: string) => p1 + p2.toUpperCase());
}

export function plural(n: number): string {
  return n + (n === 1 ? ' lead' : ' leads');
}

export function sclass(s: string): string {
  return 'st-' + (s.split(' ')[0] ?? '').toLowerCase();
}
/** Stage names as they show on screen. */
export function SL(s: string): string {
  return s === 'Didnt Pick' ? "Didn't Pick" : s === 'Won' ? 'Paid' : s;
}
export function sysText(t: string): string {
  return String(t).replace(/\bDidnt Pick\b/g, "Didn't Pick").replace(/\bWon\b/g, 'Paid');
}

export function safeUrl(u: string): string {
  return /^https?:\/\//i.test(u) ? u : '';
}
export function domain(u: string): string {
  return u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/.*$/, '');
}
export function catLabel(c: string): string {
  return c.replace(/Jewelry/g, 'Jewellery').replace(/jewelry/g, 'jewellery').replace(/Jeweler/g, 'Jeweller').replace(/jeweler/g, 'jeweller');
}
export function ucfirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function socialLabel(u: string): string {
  const t = u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '');
  return t.length > 30 ? t.slice(0, 29) + '…' : t;
}
/** A WhatsApp link from the WhatsApp number or, failing that, the phone number ('' when there is neither). */
export function waLinkOf(wa: string, phone: string): string {
  let d = wa || (phone ? phone.replace(/\D/g, '') : '');
  if (d.length === 10) d = '91' + d;
  return d ? 'https://wa.me/' + d : '';
}

/* ---------- dates ---------- */

export function fmtAt(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
export function pad2(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}
export function dkey(d: Date): string {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
export function dayOffset(n: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return dkey(d);
}
export function diffDays(key: string): number {
  const a = new Date(key + 'T12:00:00');
  const b = new Date();
  b.setHours(12, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / 864e5);
}
export function fuFull(key: string): string {
  const d = new Date(key + 'T12:00:00');
  return d.getDate() + ' ' + d.toLocaleDateString('en-GB', { month: 'short' }) + ' (' + d.toLocaleDateString('en-GB', { weekday: 'short' }) + ')';
}
export function fuText(key: string): string {
  const d = diffDays(key);
  if (d < 0) return -d + (d === -1 ? ' day late' : ' days late');
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return fuFull(key);
}
export function agoText(ts: number): string {
  const m = Math.round((Date.now() - ts) / 6e4);
  if (m < 2) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : d + ' days ago';
}
export function monthKey(y: number, m: number): string {
  return y + '-' + String(m + 1).padStart(2, '0');
}
export function shiftM(key: string, d: number): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7)) - 1 + d;
  const dt = new Date(y, m, 1);
  return monthKey(dt.getFullYear(), dt.getMonth());
}

/** Whether the object has its own property with this name. */
export function has(o: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

/** Markup snippets and fixed lists for the sales page. The strings are the page's own; the class names are styled by the page CSS. */
import type { Service, TileSpec, Workspace } from './types.js';

export type Pair = readonly [string, string];

/* Workspaces come from the server. Icon and colour are looked up by name. */
const ICON_MARK: Record<string, string> = {
  globe:'<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2M12 3.4c2.7 2.8 2.7 14.4 0 17.2M12 3.4c-2.7 2.8-2.7 14.4 0 17.2"/>',
  seo:'<circle cx="10.5" cy="10.5" r="6.2" stroke-width="2.2"/><path d="M15.2 15.2L20.2 20.2" stroke-width="2.6"/><path d="M7.7 12.2l2-2.2 1.6 1.2 2-2.6" stroke-width="1.6"/>',
  chat:'<path style="fill:#fff;stroke:none" d="M6 4h12a3 3 0 0 1 3 3v7.5a3 3 0 0 1-3 3h-5.5L8 21v-3.5H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"/><path style="fill:var(--tile);stroke:none" d="M12 14s-3.4-2-3.4-4.4a1.9 1.9 0 0 1 3.4-1.2 1.9 1.9 0 0 1 3.4 1.2C15.4 12 12 14 12 14z"/>',
  gem:'<path style="fill:#fff;stroke:none" d="M12 2.8l6.3 8.7-6.3 9.7-6.3-9.7z"/><circle cx="12" cy="10.4" r="1.7" style="fill:var(--tile);stroke:none"/><path d="M12 12v8" style="stroke:var(--tile)" stroke-width="1.6"/>',
  pen:'<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/>',
  star:'<path d="M12 4l2.4 5 5.4.7-4 3.8 1 5.4L12 16.2 7.2 18.9l1-5.4-4-3.8 5.4-.7z"/>'
};
const TILE_COLORS: Record<string, readonly [string, string]> = {blue:['#4aa3ff','#0a64e8'], green:['#4be07a','#1aa64a'], pink:['#ff6b8b','#e0244f'], violet:['#a58bff','#6d4aff'], amber:['#ffbd4a','#fb8500'], slate:['#8793a6','#505b6e']};
const SLATE: readonly [string, string] = ['#8793a6', '#505b6e'];
export function toService(w: Workspace): Service {
  const c = TILE_COLORS[w.color] || SLATE;
  return { id: w.id, name: w.name, t1: c[0], t2: c[1], icon: ICON_MARK[w.icon] || ICON_MARK.globe };
}
export function svcIcon(s: Service): string {
  return '<span class="tile-ic" style="--t1:' + s.t1 + ';--t2:' + s.t2 + ';--tile:' + s.t2 + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + s.icon + '</svg></span>';
}

/* The path of a good lead, then the ways a lead can end without a sale. 'Won' is the sale. */
export const STAGES: string[] = ['New', 'Didnt Pick', 'Follow Up', 'Meeting', 'Won'];
export const OFFRAMPS: string[] = ['Lost', 'Invalid Number', 'Invalid Email'];
export const ALLSTAGES: string[] = STAGES.concat(OFFRAMPS);
export function isOff(s: string): boolean {
  return OFFRAMPS.indexOf(s) > -1;
}
/** Ended for good: Won, Lost or invalid. */
export function isEnded(s: string): boolean {
  return s === 'Won' || isOff(s);
}
export const PAGE = 20;

export const CHEV = '<svg class="chev" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4"/></svg>';
export const CHECK = '<svg class="ck" viewBox="0 0 12 10" aria-hidden="true"><path d="M1 5l3.5 3.5L11 1.5"/></svg>';

/* "Must have": a lead only shows when it has every contact detail picked here. */
export const NEEDS: Pair[] = [['web', 'Website'], ['phone', 'Phone'], ['email', 'Email']];
export const NEED_ICON: Record<string, string> = {
  web:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.3 2.4 3.5 5.3 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.3-3.5-8.5S9.7 5.9 12 3.5z"/></svg>',
  phone:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 3.8H6.4A2.4 2.4 0 0 0 4 6.3C4.3 13.9 10.1 19.7 17.7 20a2.4 2.4 0 0 0 2.5-2.4v-1.8a1.2 1.2 0 0 0-.9-1.2l-3.1-.8a1.2 1.2 0 0 0-1.2.4l-.9 1.1a10.2 10.2 0 0 1-4.6-4.6l1.1-.9a1.2 1.2 0 0 0 .4-1.2l-.8-3.1a1.2 1.2 0 0 0-1-.9z"/></svg>',
  email:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M4.5 8l7.5 5.2L19.5 8"/></svg>'
};

export const BELL = '<svg class="bell" viewBox="0 0 24 24" aria-hidden="true"><path style="fill:#fff;stroke:none" d="M12 3.6a5.4 5.4 0 0 0-5.4 5.4v3c0 .5-.2 1-.5 1.4l-1.2 1.6c-.5.7 0 1.8.9 1.8h12.4c.9 0 1.4-1.1.9-1.8l-1.2-1.6a2.4 2.4 0 0 1-.5-1.4V9A5.4 5.4 0 0 0 12 3.6z"/><path style="fill:#fff;stroke:none" d="M9.7 18.3a2.3 2.3 0 0 0 4.6 0z"/></svg>';

const ICO: Record<string, string> = {
  cal:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 11h16"/>'
};
export function ico(n: string): string {
  return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + ICO[n] + '</svg>';
}

export const GROUPS_Q: Pair[] = [['od', 'Overdue'], ['today', 'Today'], ['later', 'Later'], ['none', 'No follow-up'], ['closed', 'Paid'], ['lost', 'Lost']];
export const CAL_DAYS: string[] = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
export const THEMES: Pair[] = [['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']];
export const KP_PERIODS: readonly (readonly [string, string, string])[] = [['today', 'Today', 'Today'], ['7d', '7 days', '7 days'], ['month', 'This month', 'Month']];

/* quick-action app icons: Call (green), WhatsApp (the official logo, path from Simple Icons, CC0), Email (blue), same tile style as the workspace icons */
const ACT: Record<string, TileSpec> = {
  call:{t1:'#5ce47f',t2:'#1fae4b',g:'<path style="fill:#fff;stroke:none" d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>'},
  whatsapp:{t1:'#25D366',t2:'#25D366',g:'<path style="fill:#fff;stroke:none" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>'},
  info:{t1:'#8f9aae',t2:'#566176',g:'<circle cx="12" cy="12" r="8.500" style="stroke:#fff;fill:none;stroke-width:1.800"/><path d="M12 11v5.500M12 7.800v.100" style="stroke:#fff;stroke-width:2.200;fill:none"/>'},
  mail:{t1:'#4aa3ff',t2:'#0a64e8',g:'<rect x="3" y="5.500" width="18" height="13" rx="2.500" style="fill:#fff;stroke:none"/><path d="M3.800 8l8.200 5.800L20.200 8" style="stroke:var(--tile);stroke-width:1.800;fill:none"/>'}
};
export function tileOf(kind: string): string {
  const a = ACT[kind];
  return '<span class="tile-ic" style="--t1:' + a.t1 + ';--t2:' + a.t2 + ';--tile:' + a.t2 + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + a.g + '</svg></span>';
}

/* ---------- Profile (phone bottom bar) ---------- */
const PI: Record<string, string> = {
  bell:'<path d="M10 5a2 2 0 1 1 4 0 7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/>',
  key:'<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M13.5 9.5l2 2"/>',
  devices:'<rect x="3" y="5" width="12" height="9" rx="1.5"/><path d="M1.5 17.5h15"/><rect x="17" y="9" width="4.5" height="9" rx="1"/>',
  logout:'<path d="M10 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H10"/><path d="M15 8l4 4-4 4M19 12H9"/>',
  today:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  chev:'<path d="M9 6l6 6-6 6"/>'
};
/* app-icon tiles for the Profile rows: gradient square, white glyph */
const PT: Record<string, readonly [string, string, string]> = {
  today:['#4be07a','#1aa64a','<circle cx="12" cy="12" r="7.8"/><path d="M12 7.7V12l3 1.8"/>'],
  bell:['#ff6b63','#e5342d','<path style="fill:#fff;stroke:none" d="M12 3.6a5.4 5.4 0 0 0-5.4 5.4v3c0 .5-.2 1-.5 1.4l-1.2 1.6c-.5.7 0 1.8.9 1.8h12.4c.9 0 1.4-1.1.9-1.8l-1.2-1.6a2.4 2.4 0 0 1-.5-1.4V9A5.4 5.4 0 0 0 12 3.6z"/><path style="fill:#fff;stroke:none" d="M9.7 18.3a2.3 2.3 0 0 0 4.6 0z"/>'],
  user:['#5ac8fa','#0a84c7','<circle cx="12" cy="8.6" r="3.4"/><path d="M5.2 19.4c.6-3.3 3.2-5 6.8-5s6.2 1.7 6.8 5"/>'],
  key:['#4aa3ff','#0a64e8','<circle cx="8.6" cy="14.6" r="3.7"/><path d="M11.3 11.9L19 4.2M16.3 7l2.3 2.3M13.9 9.4l1.7 1.7"/>'],
  devices:['#8a94a8','#4a5568','<rect x="3" y="5.5" width="13" height="9" rx="1.6"/><path d="M1.8 18h15.4"/><rect x="18" y="9.5" width="3.8" height="8.5" rx="1"/>'],
  note:['#ffbd4a','#fb8500','<path d="M6 4.5h12A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>'],
  chart:['#35cbbf','#0f9a8e','<path d="M5 19V5M5 19h14"/><path d="M9 15v-4M13 15V8M17 15v-6"/>'],
  theme:['#9a8cff','#5b45e0','<path style="fill:#fff;stroke:none" d="M19.5 14.6A7.6 7.6 0 0 1 9.4 4.5a7.6 7.6 0 1 0 10.1 10.1z"/>'],
  logout:['#3a4150','#10131a','<path d="M10 4.6H6.8A1.8 1.8 0 0 0 5 6.4v11.2a1.8 1.8 0 0 0 1.8 1.8H10"/><path d="M14.5 8.3L18.2 12l-3.7 3.7M18 12H9.6"/>']
};
export function ptile(n: string): string {
  const a = PT[n];
  return '<span class="tile-ic" style="--t1:' + a[0] + ';--t2:' + a[1] + ';--tile:' + a[1] + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + a[2] + '</svg></span>';
}
export function pi(n: string, cls?: string): string {
  return '<svg class="pi' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + PI[n] + '</svg>';
}

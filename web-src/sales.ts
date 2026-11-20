import { el } from './shared/dom.js';
import { initPwa } from './shared/pwa.js';
import { api, messageOf, statusOf } from './sales/api.js';

initPwa();
import {
  ALLSTAGES, BELL, CAL_DAYS, CHECK, CHEV, GROUPS_Q, KP_PERIODS, NEEDS, NEED_ICON, PAGE, STAGES, THEMES,
  ico, pi, ptile, svcIcon, tileOf, toService,
} from './sales/consts.js';
import { closestOf, ds, maybeEl, media, prefersReducedMotion, qs } from './sales/dom.js';
import type {
  ActivityItem, AppState, Bootstrap, Claim, ClaimComment, DdId, DdItem, FilterDrawerState, FoundNote, GbcCategory,
  GbcData, KpiPeriod, Lead, Me, Notice, NoticeItem, OwnNote, QueueGroup, Report, ServerLead, Service, Tab, Targets,
} from './sales/types.js';
import {
  SL, agoText, catLabel, dayOffset, diffDays, domain, esc, fmtAt, fuFull, fuText, has, pad2, plural, safeUrl,
  sclass, shiftM, socialLabel, sysText, toTitleCase, ucfirst, waLinkOf, monthKey,
} from './sales/util.js';

/** Fields a claim can change from the Assigned panel. */
interface ClaimPatch {
  status?: string;
  next?: string | null;
}

function isGbcCategory(c: unknown): c is GbcCategory {
  return Array.isArray(c) && c.length >= 3 && typeof c[0] === 'string' && typeof c[1] === 'number' && typeof c[2] === 'number';
}

function isGbcData(v: unknown): v is GbcData {
  return (
    typeof v === 'object' && v !== null &&
    'groups' in v && Array.isArray(v.groups) && v.groups.every((g) => typeof g === 'string') &&
    'cats' in v && Array.isArray(v.cats) && v.cats.every(isGbcCategory)
  );
}

async function loadGbc(): Promise<GbcData> {
  const res = await fetch('/assets/gbc.json');
  const data: unknown = await res.json();
  if (!isGbcData(data)) throw new Error('The category list could not be read.');
  return data;
}

function isTab(t: string): t is Tab {
  return t === 'info' || t === 'assigned' || t === 'kpi' || t === 'profile';
}
function isDdId(id: string): id is DdId {
  return id === 'area' || id === 'grp' || id === 'cat';
}
function isKpiPeriod(p: string): p is KpiPeriod {
  return p === 'today' || p === '7d' || p === 'month';
}

/* Fonts load after first paint so a slow font host can never leave the page blank. */
try {
  const fl = document.createElement('link');
  fl.rel = 'stylesheet';
  fl.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap';
  document.head.appendChild(fl);
} catch {
  /* a missing font stylesheet is not worth stopping for */
}
/* If something throws before the page is drawn, say so on screen instead of showing nothing. */
window.addEventListener('error', (ev) => {
  const v = document.getElementById('view');
  if (v && !v.firstChild) {
    const d = document.createElement('div');
    d.className = 'empty';
    const b = document.createElement('b');
    b.textContent = 'The dashboard could not start';
    d.appendChild(b);
    d.appendChild(document.createTextNode(String(ev.message || 'Unknown error')));
    v.appendChild(d);
  }
});

function showFatal(message: string): void {
  const v = document.getElementById('view');
  if (!v) return;
  v.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'empty';
  const b = document.createElement('b');
  b.textContent = 'Fynix Sales could not load';
  d.appendChild(b);
  d.appendChild(document.createTextNode(message));
  v.appendChild(d);
}

Promise.all([api<Bootstrap>('GET', '/api/sales/bootstrap'), loadGbc()])
  .then(([data, gbc]) => {
    boot(data, gbc);
  })
  .catch((e: unknown) => {
    if (statusOf(e) !== 401) showFatal(messageOf(e, 'Please refresh the page.'));
  });

function boot(DATA: Bootstrap, GBC: GbcData): void {
  if (!DATA.workspaces.length) {
    qs('.tabs').style.display = 'none';
    el('ws-dd').style.display = 'none';
    showFatal('You are not in any service yet. Ask your superadmin to add you to one.');
    return;
  }
  const USERS: Me[] = [DATA.me];

  /* All Google Business categories (lobstrio/google-business-categories): [name, industry group index, worldwide businesses]. */
  const GROUPS = GBC.groups;
  const CATS = GBC.cats;
  const CAT_GROUP: Record<string, number> = {};
  const CAT_CANON: Record<string, string> = {};
  CATS.forEach((c) => {
    CAT_GROUP[c[0]] = c[1];
    CAT_CANON[c[0].toLowerCase()] = c[0];
  });
  const CAT_ALIAS: Record<string, string> = { 'diamond merchant': 'Diamond dealer', 'gemstone jeweler': 'Gemstone dealer', 'designer clothing store': 'Clothing store' };

  function prepLead(r: ServerLead): Lead {
    const k = String(r.cat || '').toLowerCase();
    r.cat = CAT_CANON[k] || CAT_ALIAS[k] || r.cat || '';
    r.email = r.email || [];
    r.open = r.open || [];
    r.work = r.work || {};
    r.company = r.company || '';
    r.title = r.title || '';
    r.personalNumber = r.personalNumber || '';
    r.keywords = r.keywords || '';
    r.linkedin = r.linkedin || '';
    return Object.assign(r, { grp: has(CAT_GROUP, r.cat) ? CAT_GROUP[r.cat] : -1 });
  }
  const LEADS: Lead[] = DATA.leads.map(prepLead);

  function isScale(): boolean {
    const s = svcById(state.service);
    return !!(s && s.id && s.id.indexOf('scale') === 0) || DATA.category === 'scale' || DATA.me.category === 'scale';
  }

  const SERVICES: Service[] = DATA.workspaces.map(toService);

  /** The word for a stage as it shows on screen is SL(); STAGES, ALLSTAGES and PAGE live in sales/consts.ts. */
  const state: AppState = {
    user: DATA.me.id, service: SERVICES[0].id, tab: 'info', q: '', area: '', grp: '', cat: '', need: [], open: '', sort: 'rev', page: 0,
    selected: null, showDetail: false, stageFilter: '', logStage: '', stgOpen: {}, stgLead: '', calMonth: '', qf: '', closedOpen: false,
    kpiPeriod: 'month', read: {}, modal: null,
  };
  DATA.reads.forEach((k) => {
    state.read[k] = true;
  });
  function failToast(e: unknown): void {
    toast(messageOf(e, 'Something went wrong. Please try again.'));
  }

  function lockScroll(): void {
    document.documentElement.classList.add('modal-locked');
    document.body.classList.add('modal-locked');
  }
  function unlockScroll(): void {
    document.documentElement.classList.remove('modal-locked');
    document.body.classList.remove('modal-locked');
  }
  function bindScrim(sc: HTMLElement): void {
    sc.addEventListener('touchmove', (e) => {
      if (e.target === sc) e.preventDefault();
    }, { passive: false });
  }
  /** Wires the scrim of the modal that was just drawn: no scroll-through, and a press on the backdrop closes it. */
  function wireScrim(): void {
    const sc = el('scrim');
    bindScrim(sc);
    sc.addEventListener('mousedown', (e) => {
      if (e.target instanceof HTMLElement && e.target.id === 'scrim') closeModal();
    });
  }

  /* The last three stages a lead went through, ending at where it is now, e.g. Contacted -> Interested -> Meeting. */
  function assignedStagePreview(w: Claim | null): string {
    const seq: string[] = [];
    ((w && w.history) || []).forEach((h) => {
      if (seq[seq.length - 1] !== h.s) seq.push(h.s);
    });
    if (w && w.status && seq[seq.length - 1] !== w.status) seq.push(w.status);
    if (!w || !w.status || seq.length < 2) {
      return '<span class="st-preview st-new"><span class="st-lbl">Stage:</span> <span class="st-val">' + esc(SL((w && w.status) || 'New')) + '</span></span>';
    }
    const trail = seq.slice(-3);
    const cur = trail.pop() ?? w.status;
    return '<span class="st-preview st-moved">' + trail.map((x) => {
      return '<span class="st-from">' + esc(SL(x)) + '</span> <span class="st-arr" aria-hidden="true">&rarr;</span> ';
    }).join('') + '<span class="st-val ' + sclass(cur) + '">' + esc(SL(cur)) + '</span></span>';
  }

  function user(id: string): Me | undefined {
    return USERS.find((u) => u.id === id);
  }
  /** The signed-in person (the only user this page ever shows as "state.user"). */
  function self(): Me {
    return user(state.user) ?? DATA.me;
  }
  function W(l: Lead): Claim | null {
    return l.work[state.service] || null;
  }
  /** The claim on a lead in the current service; the lists that call this only hold assigned leads. */
  function claim(l: Lead): Claim {
    const w = W(l);
    if (!w) throw new Error('Lead ' + l.id + ' is not assigned in ' + state.service + '.');
    return w;
  }
  function svcById(id: string): Service | undefined {
    return SERVICES.find((s) => s.id === id);
  }
  function svc(id: string): Service {
    const s = svcById(id);
    if (!s) throw new Error('Unknown service ' + id + '.');
    return s;
  }
  function svcName(): string {
    return svc(state.service).name;
  }
  function mine(): Lead[] {
    return LEADS.filter((l) => {
      const w = W(l);
      return !!w && w.owner === state.user;
    });
  }
  function open_(): Lead[] {
    return LEADS.filter((l) => l.open.indexOf(state.service) > -1);
  }
  function alsoHtml(l: Lead): string {
    const s = Object.keys(l.work).filter((k) => k !== state.service && l.work[k].owner === state.user);
    return s.length ? '<div class="sm">Also yours in ' + s.map((k) => esc(svc(k).name)).join(', ') + '</div>' : '';
  }
  function byId(id: string | null): Lead | undefined {
    return LEADS.find((l) => l.id === id);
  }
  function matchQ(l: Lead): boolean {
    const q = state.q.trim().toLowerCase();
    return !q || (l.name + ' ' + (l.company || '') + ' ' + (l.title || '') + ' ' + (l.keywords || '') + ' ' + l.area + ' ' + l.cat + ' ' + l.email.join(' ')).toLowerCase().indexOf(q) > -1;
  }
  function mapsUrl(l: Lead): string {
    return 'https://www.google.com/maps/place/?q=place_id:' + encodeURIComponent(l.pid);
  }
  function todayHours(l: Lead): string {
    const h = l.hrs;
    const i = (new Date().getDay() + 6) % 7;
    const v = Array.isArray(h) ? h[i] : h;
    return v ? v : 'Not listed';
  }

  const view = el('view');
  const layer = el('layer');

  function signOut(): void {
    const toLogin = (): void => {
      window.location.href = '/login';
    };
    api<unknown>('POST', '/api/auth/logout').then(toLogin).catch(toLogin);
  }

  function toast(msg: string): void {
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => {
      t.remove();
    }, 2600);
  }

  /* slide the glass capsule under the selected tab, and ease the content in when the section changes */
  let scrollLock = 0;
  function placePill(): void {
    const i = ['info', 'assigned', 'kpi', 'profile'].indexOf(state.tab);
    qs('.tabs').style.setProperty('--i', String(i < 0 ? 0 : i));
  }
  /* Switching tabs: each block drops in from above, one after another, top to bottom. */
  const SHOWER = '.head,.tools,.kseg,.katt,.ksec,.kcard,.kpnote,tbody tr,.qhead,.qsec,.item-wrap,.pager,.empty,.pf-card,.pf-stats,.pf-cap,.pf-today,.pf-h,.pf-list,.detail';
  function shower(): void {
    if (prefersReducedMotion()) return;
    const els = view.querySelectorAll<HTMLElement>(SHOWER);
    const vh = window.innerHeight;
    for (let i = 0, n = 0; i < els.length; i++) {
      const node = els[i];
      if (node.getBoundingClientRect().top > vh) continue; /* only what is on screen */
      node.style.animation = 'v-fall .75s cubic-bezier(.22,.8,.3,1) ' + Math.min(n, 18) * 60 + 'ms backwards';
      n++;
    }
  }
  function animateView(kind: 'tab' | 'push' | 'pop'): void {
    view.classList.remove('v-tab', 'v-push', 'v-pop');
    if (kind === 'tab') {
      shower();
      return;
    }
    void view.offsetWidth;
    view.classList.add('v-' + kind);
  }
  function settleBar(): void {
    scrollLock = Date.now() + 700;
    lastFlip = Date.now();
    qs('.tabs').classList.remove('min');
  }

  function chrome(): void {
    const tt = document.getElementById('top-title');
    if (tt) {
      const tabTitles: Record<string, string> = { info: 'Leads', assigned: 'Assigned', kpi: 'KPIs', profile: 'Profile' };
      tt.textContent = tabTitles[state.tab] || 'Leads';
    }
    el('cnt-assigned').textContent = String(mine().length);
    ['info', 'assigned', 'kpi', 'profile'].forEach((t) => {
      el('tab-' + t).setAttribute('aria-selected', String(state.tab === t));
    });
    qs('.top').classList.toggle('kpi', state.tab === 'kpi' || state.tab === 'profile');
    el('tab-av').textContent = self().ini;
    el('avatar').textContent = self().ini;
    renderWho();
    renderWs();
    renderNt();
    placePill();
    updateFilterBadge();
    if (state.tab !== 'info' && fd.open) closeDrawer(true);
  }

  /* ---------- Leads tab ---------- */
  /* Maps-style imports put the store name in the title column; a job title that just repeats the name is left out. */
  function jobTitleOf(l: Lead): string {
    const t = (l.title || '').trim();
    return t && t.toLowerCase() !== (l.name || '').trim().toLowerCase() ? t : '';
  }
  /* Company in bold and the website link under it; a dash only when there is neither. */
  function compCell(l: Lead, w: string): string {
    const h = (l.company ? '<b>' + esc(toTitleCase(l.company)) + '</b>' : '') + (w ? '<div class="sm"><a class="ext" href="' + esc(w) + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()"><span>' + esc(domain(w)) + '</span><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1h6v6M9 1L1 9"/></svg></a></div>' : '');
    return h || '<span class="dash">—</span>';
  }
  function renderInfo(): void {
    const all = open_();
    const rows = all.filter((l) => {
      return (!state.area || l.area === state.area) && (state.grp === '' || l.grp === state.grp) && (!state.cat || l.cat === state.cat) && needOk(l) &&
        matchQ(l);
    });
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (state.page >= pages) state.page = pages - 1;
    const slice = rows.slice(state.page * PAGE, state.page * PAGE + PAGE);

    let h = '<div class="head"><h1>Leads</h1><span class="sub">' + esc(svcName()) + '</span></div>' +
      '<div class="tools"><div class="tools-d">' +
      ddHtml('area', 'Filter by area') + ddHtml('cat', 'Filter by category') + toolsWsHtml() + needsHtml() +
      '<span class="grow num">' + rows.length + ' of ' + all.length + ' leads</span></div>' +
      '<div class="tools-p"><div class="tp-row"><span class="num">' + rows.length + ' of ' + all.length + ' leads</span>' +
      '<button type="button" class="fbtn" id="fbtn" data-fopen aria-label="Filters' + (activeFilters().length ? ', ' + activeFilters().length + ' active' : '') + '" aria-haspopup="dialog" aria-expanded="' + fd.open + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>Filters<i class="fb-n" id="fbn">' + (activeFilters().length || '') + '</i></button></div>' +
      '<div class="ftags">' + activeFilters().map((f) => {
        return '<button type="button" class="ftag" data-fclear="' + f[0] + '" aria-label="Remove filter ' + esc(f[1]) + '"><span>' + esc(f[1]) + '</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>';
      }).join('') + '</div></div></div>';

    if (!rows.length) {
      h += '<div class="tablewrap"><div class="empty"><b>' + (all.length ? 'No leads match' : 'No leads to assign') + '</b>' + (all.length ? 'Clear the search or filters.' : 'New rows appear when the admin imports another file.') + '</div></div>';
    } else {
      const tableHead = isScale()
        ? '<thead><tr><th class="sr">Sr. no</th><th>Person</th><th>Company</th><th>Job Title</th><th>Personal Number</th><th></th></tr></thead>'
        : '<thead><tr><th class="sr">Sr. no</th><th>Brand</th><th>Area</th><th></th></tr></thead>';

      const rowsHtml = slice.map((l, n) => {
        if (isScale()) {
          const pNum = l.personalNumber || l.phone;
          const w = safeUrl(l.web);
          return '<tr class="lead-row scale-row" data-assign="' + l.id + '" style="cursor:pointer">' +
            '<td class="sr num c-sr">' + (state.page * PAGE + n + 1) + '</td>' +
            '<td class="c-name"><div class="name">' + esc(toTitleCase(l.name)) + '</div>' + ((l.area || l.city) ? '<div class="sm muted place">' + esc(toTitleCase(l.area || l.city)) + '</div>' : '') + (l.email.length ? '<div class="sm muted em">' + esc(l.email[0]) + '</div>' : '') + alsoHtml(l) + '</td>' +
            '<td class="c-comp">' + compCell(l, w) + '</td>' +
            '<td class="c-title">' + (jobTitleOf(l) ? esc(toTitleCase(jobTitleOf(l))) : '<span class="dash">—</span>') + '</td>' +
            '<td class="num c-phone">' + (pNum ? '<span class="num">' + esc(pNum) + '</span>' : '<span class="dash">—</span>') + '</td>' +
            '<td class="r c-act"><button class="btn xs assign" data-assign="' + l.id + '" aria-label="Review and assign ' + esc(toTitleCase(l.name)) + '">Assign</button></td>' +
          '</tr>';
        }
        return '<tr class="lead-row" data-assign="' + l.id + '" style="cursor:pointer">' +
          '<td class="sr num c-sr">' + (state.page * PAGE + n + 1) + '</td>' +
          '<td class="c-name"><div class="name">' + esc(toTitleCase(l.name)) + '</div>' + alsoHtml(l) + '</td>' +
          '<td class="c-area">' + (l.area ? esc(toTitleCase(l.area)) : '<span class="dash">—</span>') + (l.city ? '<div class="sm">' + esc(toTitleCase(l.city)) + '</div>' : '') + '</td>' +
          '<td class="r c-act"><button class="btn xs assign" data-assign="' + l.id + '" aria-label="Review and assign ' + esc(toTitleCase(l.name)) + '">Assign</button></td>' +
        '</tr>';
      }).join('');

      h += '<div class="tablewrap"><table>' + tableHead + '<tbody>' + rowsHtml + '</tbody></table></div>' +
      '<div class="pager"><span>Showing <span class="num">' + (state.page * PAGE + 1) + '–' + (state.page * PAGE + slice.length) + '</span> of <span class="num">' + rows.length + '</span> · ' + PAGE + ' per page</span>' +
      pagerHtml(state.page, pages) + '</div>';
    }
    view.innerHTML = h;
    const pop = document.querySelector<HTMLElement>('.tools .pop');
    if (pop) {
      const over = pop.getBoundingClientRect().right - (window.innerWidth - 16);
      if (over > 0) pop.style.left = (-over) + 'px';
    }
    const qi = maybeEl('dd-q', HTMLInputElement);
    if (qi) {
      qi.focus();
      qi.addEventListener('input', () => {
        const id = state.open;
        if (isDdId(id)) el('dd-list').innerHTML = ddListHtml(id, qi.value);
      });
    }
  }

  function pagerHtml(page: number, pages: number): string {
    const nums: number[] = [];
    let last = -1;
    for (let i = 0; i < pages; i++) {
      if (i === 0 || i === pages - 1 || Math.abs(i - page) <= 1) nums.push(i);
    }
    let h = '<div class="btns" role="navigation" aria-label="Pages"><button class="btn xs arrow" data-page="-1" aria-label="Previous page"' + (page === 0 ? ' disabled' : '') + '><svg viewBox="0 0 6 10" aria-hidden="true"><path d="M5 1L1 5l4 4"/></svg></button>';
    nums.forEach((i) => {
      if (last >= 0 && i - last > 1) h += '<span class="gap" aria-hidden="true">…</span>';
      h += '<button class="btn xs pg' + (i === page ? ' cur' : '') + '" data-goto="' + i + '"' + (i === page ? ' aria-current="page"' : '') + '>' + (i + 1) + '</button>';
      last = i;
    });
    return h + '<button class="btn xs arrow" data-page="1" aria-label="Next page"' + (page >= pages - 1 ? ' disabled' : '') + '><svg viewBox="0 0 6 10" aria-hidden="true"><path d="M1 1l4 4-4 4"/></svg></button></div>';
  }

  /* ---------- Dropdowns ---------- */
  const DD: Record<DdId, { all: string; search?: string }> = {
    area: { all: 'All areas', search: 'Search areas' },
    grp: { all: 'All industries' },
    cat: { all: 'All categories', search: 'Search ' + CATS.length.toLocaleString() + ' categories' },
  };
  function ddCurrent(id: DdId): string {
    const v = state[id];
    return v === '' || v == null ? '' : String(v);
  }
  function ddLabel(id: DdId): string {
    const v = ddCurrent(id);
    const d = DD[id];
    if (v === '') return d.all;
    if (id === 'grp') return GROUPS[Number(v)];
    if (id === 'cat') return catLabel(v);
    return v;
  }
  function ddItems(id: DdId, q: string): { items: DdItem[]; total: number } {
    const ql = q.trim().toLowerCase();
    const pool = open_();
    const m: Record<string, number> = {};
    let items: DdItem[];
    if (id === 'area') {
      pool.forEach((l) => {
        if (l.area) m[l.area] = (m[l.area] || 0) + 1;
      });
      items = Object.keys(m).filter((a) => !ql || a.toLowerCase().indexOf(ql) > -1).map((a) => ({ v: a, l: a, sub: plural(m[a]), n: m[a], w: 0, zero: false }));
      items.sort((a, b) => b.n - a.n || a.l.localeCompare(b.l));
    } else if (id === 'grp') {
      pool.forEach((l) => {
        if (l.grp > -1) m[l.grp] = (m[l.grp] || 0) + 1;
      });
      items = GROUPS.map((g, i) => ({ v: String(i), l: g, sub: plural(m[i] || 0), n: m[i] || 0, w: 0, zero: !m[i] }))
        .filter((x) => !ql || x.l.toLowerCase().indexOf(ql) > -1);
      items.sort((a, b) => b.n - a.n || a.l.localeCompare(b.l));
    } else {
      pool.forEach((l) => {
        m[l.cat] = (m[l.cat] || 0) + 1;
      });
      items = CATS.filter((c) => {
        if (state.grp !== '' && c[1] !== state.grp) return false;
        return !ql || (c[0] + ' ' + catLabel(c[0])).toLowerCase().indexOf(ql) > -1;
      }).map((c) => {
        const n = m[c[0]] || 0;
        return { v: c[0], l: catLabel(c[0]), sub: GROUPS[c[1]] + ' · ' + plural(n), n, w: c[2], zero: !n };
      });
      items.sort((a, b) => b.n - a.n || b.w - a.w);
    }
    return { items: items.slice(0, 50), total: items.length };
  }
  function optHtml(attr: string, v: string, l: string, sub: string, sel: boolean, zero?: boolean, icon?: string): string {
    return '<button type="button" class="opt' + (zero ? ' zero' : '') + '" role="option" ' + attr + '="' + esc(v) + '" aria-selected="' + sel + '">' + (icon || '') + '<span class="ol"><span>' + esc(l) + '</span>' + (sub ? '<span class="sm">' + esc(sub) + '</span>' : '') + '</span>' + CHECK + '</button>';
  }
  function ddListHtml(id: DdId, q: string): string {
    const r = ddItems(id, q);
    const cur = ddCurrent(id);
    const d = DD[id];
    let h = (d.all && !q.trim() ? optHtml('data-v', '', d.all, '', cur === '') : '') + r.items.map((it) => optHtml('data-v', it.v, it.l, it.sub, cur === it.v, it.zero)).join('');
    h = h.replace(/data-v=/g, 'data-ddopt="' + id + '" data-v=');
    if (!r.items.length) h += '<div class="sm nores">No match found.</div>';
    else if (r.total > r.items.length) h += '<div class="sm nores">Showing ' + r.items.length + ' of ' + r.total + '. Type to narrow down.</div>';
    return h;
  }
  function ddHtml(id: DdId, aria: string): string {
    const open = state.open === id;
    const d = DD[id];
    return '<div class="combo"><button type="button" class="field combo-btn" data-ddbtn="' + id + '" aria-label="' + esc(aria) + '" aria-haspopup="listbox" aria-expanded="' + open + '"><span>' + esc(ddLabel(id)) + '</span>' + CHEV + '</button>' +
      (open ? '<div class="pop">' + (d.search ? '<input class="field" id="dd-q" type="search" placeholder="' + esc(d.search) + '" aria-label="' + esc(aria) + '">' : '') + '<div class="opts" id="dd-list" role="listbox">' + ddListHtml(id, '') + '</div></div>' : '') + '</div>';
  }
  function ddSet(id: DdId, v: string): void {
    if (id === 'grp') {
      state.grp = v === '' ? '' : parseInt(v, 10);
      if (state.cat && state.grp !== '' && CAT_GROUP[state.cat] !== state.grp) state.cat = '';
    } else state[id] = v;
    state.page = 0;
  }
  function setOpen(next: string): void {
    const prev = state.open;
    state.open = next;
    if (prev === 'who' || next === 'who') renderWho();
    if (prev === 'nt' || next === 'nt') renderNt(true);
    if (prev === 'ws' || next === 'ws') renderWs();
    if (prev === 'tools-ws' || next === 'tools-ws') renderInfo();
    function inView(x: string): boolean {
      return x !== '' && x !== 'who' && x !== 'ws' && x !== 'tools-ws' && x !== 'stage' && x !== 'fu' && x !== 'sf' && x !== 'nt';
    }
    if (state.tab === 'assigned' && (prev === 'stage' || next === 'stage' || prev === 'fu' || next === 'fu' || prev === 'sf' || next === 'sf')) renderAssigned();
    if (state.tab === 'info' && (inView(prev) || inView(next))) renderInfo();
  }
  /** The service list popup, shared by the top-bar switcher and the one in the Leads toolbar. */
  function serviceOptions(): string {
    return SERVICES.map((x) => {
      const free = LEADS.filter((l) => l.open.indexOf(x.id) > -1).length;
      const mineN = LEADS.filter((l) => l.work[x.id] && l.work[x.id].owner === state.user).length;
      return optHtml('data-wsopt', x.id, x.name, free + ' open · ' + mineN + ' assigned', x.id === state.service, false, svcIcon(x));
    }).join('');
  }
  function toolsWsHtml(): string {
    const open = state.open === 'tools-ws';
    const s = svc(state.service);
    return '<div class="combo" id="tools-ws-dd"><button type="button" class="field combo-btn" data-ddbtn="tools-ws" data-toolswsbtn aria-label="Switch service" aria-haspopup="listbox" aria-expanded="' + open + '"><span>' + esc(s.name) + '</span>' + CHEV + '</button>' +
      (open ? '<div class="pop"><div class="sm pop-h">Service</div><div class="opts" role="listbox">' + serviceOptions() + '</div></div>' : '') + '</div>';
  }
  function renderWs(): void {
    const open = state.open === 'ws';
    const s = svc(state.service);
    el('ws-dd').innerHTML = '<button type="button" class="ws-btn" data-wsbtn aria-label="Switch service" aria-haspopup="listbox" aria-expanded="' + open + '">' + svcIcon(s) + '<b>' + esc(s.name) + '</b>' + CHEV + '</button>' +
      (open ? '<div class="pop"><div class="sm pop-h">Service</div><div class="opts" role="listbox">' + serviceOptions() + '</div></div>' : '') +
      '<span class="ws-lbl">' + esc(s.name) + '</span>';
  }
  function switchService(id: string): void {
    if (id === state.service) {
      setOpen('');
      return;
    }
    state.service = id;
    state.selected = null;
    state.showDetail = false;
    state.q = state.area = state.cat = '';
    state.grp = '';
    state.need = [];
    state.page = 0;
    state.open = '';
    el<HTMLInputElement>('gq').value = '';
    closeModal();
    settleBar();
    window.scrollTo(0, 0);
    render();
    animateView('tab');
    if (fd.open) {
      fd.sec = '';
      fd.q = '';
      renderDrawer();
    }
  }
  /* Phone sheets: a grab handle, a round close button, and drag-to-close from the handle or the header.
     The drag uses the separate `translate` property, so the slide-up and slide-down animations keep working. */
  (function () {
    const mqS = media('(max-width:820px)');
    function enhance(modal: HTMLElement): void {
      if (modal.dataset.sheet) return;
      modal.dataset.sheet = '1';
      const grab = document.createElement('div');
      grab.className = 'm-grab';
      grab.setAttribute('aria-hidden', 'true');
      grab.innerHTML = '<i></i>';
      modal.insertBefore(grab, modal.firstChild);
      let startY = 0;
      let dy = 0;
      let t0 = 0;
      let active = false;
      function down(e: PointerEvent): void {
        if (!mqS || !mqS.matches || e.button > 0) return;
        const t = e.target instanceof Element ? e.target : null;
        if (t && t.closest('button,a,input,textarea,select')) return;
        if (modal.scrollTop > 0 && !(t && t.closest('.m-grab'))) return;
        active = true;
        startY = e.clientY;
        dy = 0;
        t0 = Date.now();
        modal.style.transition = 'none';
        try {
          if (e.currentTarget instanceof Element) e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* pointer capture is a nicety; dragging still works without it */
        }
      }
      function move(e: PointerEvent): void {
        if (!active) return;
        dy = Math.max(0, e.clientY - startY);
        modal.style.translate = '0 ' + dy + 'px';
      }
      function up(): void {
        if (!active) return;
        active = false;
        const fast = dy / (Date.now() - t0 + 1) > 0.6;
        if (dy > 110 || (fast && dy > 40)) {
          modal.style.transition = 'translate .22s cubic-bezier(.4,0,1,1)';
          modal.style.translate = '0 100%';
          setTimeout(() => {
            modal.style.visibility = 'hidden';
            closeModal();
          }, 210);
        } else {
          modal.style.transition = 'translate .3s cubic-bezier(.22,1,.36,1)';
          modal.style.translate = '0 0';
          setTimeout(() => {
            modal.style.transition = '';
            modal.style.translate = '';
          }, 300);
        }
      }
      [grab, modal.querySelector<HTMLElement>('.m-head')].forEach((node) => {
        if (!node) return;
        node.addEventListener('pointerdown', down);
        node.addEventListener('pointermove', move);
        node.addEventListener('pointerup', up);
        node.addEventListener('pointercancel', up);
      });
    }
    new MutationObserver(() => {
      const m = layer.querySelector<HTMLElement>('.scrim .modal');
      if (m) enhance(m);
    }).observe(layer, { childList: true, subtree: true });
  })();

  /* ---------- Filters drawer (phone) ---------- */
  const fd: FilterDrawerState = { open: false, sec: '', q: '', needOpen: true };
  function hasField(l: Lead, k: string): boolean {
    if (k === 'web') return !!safeUrl(l.web);
    if (k === 'phone') return !!(l.personalNumber || l.phone);
    return !!(l.email && l.email.length);
  }
  function needOk(l: Lead): boolean {
    return state.need.every((k) => hasField(l, k));
  }
  function needLabel(k: string): string {
    return NEEDS.find((n) => n[0] === k)?.[1] ?? k;
  }
  /* Re-draw the list, then fade the new rows in so a filter change never snaps. */
  function refineInfo(): void {
    renderInfo();
    const tw = view.querySelector<HTMLElement>('.tablewrap');
    if (!tw || prefersReducedMotion()) return;
    tw.classList.remove('rows-in');
    void tw.offsetWidth;
    tw.classList.add('rows-in');
  }
  function toggleNeed(k: string): void {
    const i = state.need.indexOf(k);
    if (i > -1) state.need.splice(i, 1);
    else state.need.push(k);
    state.page = 0;
  }
  function clearFilter(id: string): void {
    if (id.indexOf('need:') === 0) {
      const k = id.slice(5);
      const i = state.need.indexOf(k);
      if (i > -1) state.need.splice(i, 1);
      state.page = 0;
    } else if (isDdId(id)) ddSet(id, '');
  }
  function activeFilters(): [string, string][] {
    const a: [string, string][] = [];
    if (state.area) a.push(['area', toTitleCase(state.area)]);
    if (state.cat) a.push(['cat', catLabel(state.cat)]);
    state.need.forEach((k) => {
      a.push(['need:' + k, 'Has ' + needLabel(k).toLowerCase()]);
    });
    return a;
  }
  function infoRows(): Lead[] {
    return open_().filter((l) => {
      return (!state.area || l.area === state.area) && (state.grp === '' || l.grp === state.grp) && (!state.cat || l.cat === state.cat) && needOk(l) && matchQ(l);
    });
  }
  function updateFilterBadge(): void {
    const b = document.getElementById('fbtn');
    const n = document.getElementById('fbn');
    if (!b || !n) return;
    const c = activeFilters().length;
    n.textContent = c ? String(c) : '';
    b.setAttribute('aria-label', 'Filters' + (c ? ', ' + c + ' active' : ''));
  }
  function needsHtml(): string {
    return '<div class="needs" role="group" aria-label="Must have"><span class="sm muted">Must have</span>' + NEEDS.map((n) => {
      return '<button type="button" class="need" data-need="' + n[0] + '" aria-pressed="' + (state.need.indexOf(n[0]) > -1) + '">' + NEED_ICON[n[0]] + '<span>' + n[1] + '</span></button>';
    }).join('') + '</div>';
  }
  /* Phone drawer: "Must have" is an open list with a tick box and a count per detail. */
  /* Update the open drawer in place (tick boxes, summary, button) so nothing in it flashes or jumps. */
  function syncDrawerNeeds(): void {
    const d = document.getElementById('fdrawer');
    if (!d) return;
    NEEDS.forEach((n) => {
      const b = d.querySelector('[data-needopt="' + n[0] + '"]');
      if (b) b.setAttribute('aria-checked', state.need.indexOf(n[0]) > -1 ? 'true' : 'false');
    });
    const v = d.querySelector('[data-fdneed] .v');
    if (v) {
      const picked = NEEDS.filter((n) => state.need.indexOf(n[0]) > -1);
      v.textContent = picked.length ? picked.map((n) => n[1]).join(', ') : 'Any';
    }
    const cta = d.querySelector('.fd-f .primary');
    if (cta) cta.textContent = 'Show ' + plural(infoRows().length);
    const f = d.querySelector('.fd-f');
    const clear = f && f.querySelector('[data-fdclear]');
    const any = activeFilters().length > 0;
    if (f && any && !clear) f.insertAdjacentHTML('afterbegin', '<button type="button" class="btn" data-fdclear>Clear all</button>');
    if (clear && !any) clear.remove();
  }
  function needsDrawerHtml(): string {
    const pool = open_();
    const on = fd.needOpen;
    const picked = NEEDS.filter((n) => state.need.indexOf(n[0]) > -1);
    function row(attr: string, val: string, label: string, sub: string, checked: string, icon: string): string {
      return '<button type="button" class="opt nopt" role="checkbox" aria-checked="' + checked + '" ' + attr + '="' + val + '">' + icon + '<span class="ol"><span>' + label + '</span><span class="sm">' + sub + '</span></span><span class="cbx" aria-hidden="true"></span></button>';
    }
    const rows = NEEDS.map((n) => {
      const c = pool.filter((l) => hasField(l, n[0])).length;
      return row('data-needopt', n[0], n[1], plural(c), state.need.indexOf(n[0]) > -1 ? 'true' : 'false', '<span class="nic">' + NEED_ICON[n[0]] + '</span>');
    }).join('');
    return '<div class="fd-sec"><button type="button" class="fd-acc" data-fdneed aria-expanded="' + on + '"><span><b>Must have</b><span class="v">' + (picked.length ? esc(picked.map((n) => n[1]).join(', ')) : 'Any') + '</span></span>' + CHEV + '</button>' +
      (on ? '<div class="opts" role="listbox" aria-multiselectable="true">' + rows + '</div>' : '') + '</div>';
  }
  function renderDrawer(): void {
    const d = document.getElementById('fdrawer');
    if (!d) return;
    const n = infoRows().length;
    const act = activeFilters().length;
    function acc(id: DdId, title: string): string {
      const on = fd.sec === id;
      return '<div class="fd-sec"><button type="button" class="fd-acc" data-fdsec="' + id + '" aria-expanded="' + on + '"><span><b>' + title + '</b><span class="v">' + esc(ddLabel(id)) + '</span></span>' + CHEV + '</button>' +
        (on ? '<input class="field" id="fd-q" type="search" placeholder="' + esc(DD[id].search ?? '') + '" aria-label="' + esc(title) + '" value="' + esc(fd.q) + '"><div class="opts fd-list" id="fd-list" role="listbox">' + ddListHtml(id, fd.q) + '</div>' : '') + '</div>';
    }
    d.innerHTML = '<div class="fd-h"><h2>Filters</h2><button type="button" class="fd-x" data-fdclose aria-label="Close filters"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      '<div class="fd-b">' + needsDrawerHtml() + acc('area', 'Area') + acc('cat', 'Category') + '</div>' +
      '<div class="fd-f">' + (act ? '<button type="button" class="btn" data-fdclear>Clear all</button>' : '') + '<button type="button" class="btn primary" data-fdclose>Show ' + plural(n) + '</button></div>';
  }
  function openDrawer(): void {
    if (fd.open) return;
    fd.open = true;
    fd.sec = '';
    fd.q = '';
    fd.needOpen = true;
    renderDrawer();
    const d = el('fdrawer');
    d.setAttribute('aria-hidden', 'false');
    d.classList.add('open');
    el('fscrim').classList.add('open');
    document.body.style.overflow = 'hidden';
    const fb = document.getElementById('fbtn');
    if (fb) fb.setAttribute('aria-expanded', 'true');
    setTimeout(() => {
      const x = d.querySelector<HTMLElement>('.fd-x');
      if (x) x.focus();
    }, 60);
  }
  function closeDrawer(quiet?: boolean): void {
    if (!fd.open) return;
    fd.open = false;
    const d = el('fdrawer');
    d.classList.remove('open');
    d.setAttribute('aria-hidden', 'true');
    el('fscrim').classList.remove('open');
    document.body.style.overflow = '';
    const b = document.getElementById('fbtn');
    if (b) {
      b.setAttribute('aria-expanded', 'false');
      if (!quiet) b.focus();
    }
  }
  document.addEventListener('click', (e) => {
    if (closestOf(e, '[data-fopen]')) {
      openDrawer();
      return;
    }
    if (closestOf(e, '[data-fdclose]')) {
      closeDrawer();
      return;
    }
    const sec = closestOf(e, '[data-fdsec]');
    if (sec) {
      const id = ds(sec, 'fdsec');
      fd.sec = isDdId(id) && fd.sec !== id ? id : '';
      fd.q = '';
      renderDrawer();
      const q = document.getElementById('fd-q');
      if (q) q.focus();
      return;
    }
    if (closestOf(e, '[data-fdneed]')) {
      fd.needOpen = !fd.needOpen;
      renderDrawer();
      return;
    }
    const no = closestOf(e, '[data-needopt]');
    if (no) {
      toggleNeed(ds(no, 'needopt'));
      refineInfo();
      updateFilterBadge();
      syncDrawerNeeds();
      return;
    }
    const ob = closestOf(e, '#fdrawer [data-ddopt]');
    if (ob) {
      const id = ds(ob, 'ddopt');
      if (isDdId(id)) ddSet(id, ds(ob, 'v'));
      fd.sec = '';
      fd.q = '';
      refineInfo();
      updateFilterBadge();
      renderDrawer();
      return;
    }
    if (closestOf(e, '[data-fdclear]')) {
      state.area = '';
      state.cat = '';
      state.grp = '';
      state.need = [];
      state.page = 0;
      refineInfo();
      updateFilterBadge();
      renderDrawer();
      return;
    }
    const fc = closestOf(e, '[data-fclear]');
    if (fc) {
      clearFilter(ds(fc, 'fclear'));
      refineInfo();
      updateFilterBadge();
    }
  });
  document.addEventListener('input', (e) => {
    if (!(e.target instanceof HTMLInputElement) || e.target.id !== 'fd-q' || !fd.sec) return;
    fd.q = e.target.value;
    el('fd-list').innerHTML = ddListHtml(fd.sec, fd.q);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fd.open) closeDrawer();
  });
  const mqFd = media('(max-width:820px)');
  if (mqFd) {
    mqFd.addEventListener('change', () => {
      if (!mqFd.matches) closeDrawer(true);
    });
  }

  /* ---------- Notifications ---------- */
  /* Demo-only: the admin panel will send real notices like this one. */
  const NOTICES: Notice[] = DATA.notices.slice();
  function notifications(): NoticeItem[] {
    const out: NoticeItem[] = [];
    LEADS.forEach((l) => {
      Object.keys(l.work).forEach((sid) => {
        const w = l.work[sid];
        if (w.owner !== state.user || !w.next || w.status === 'Won' || w.status === 'Lost') return;
        const d = diffDays(w.next);
        if (d < 0) out.push({ id: 'od:' + l.id + ':' + sid + ':' + w.next, kind: 'od', rank: 0, late: -d, title: l.name, sub: 'Follow-up', tag: (-d) + 'd late', svc: sid, lead: l.id, unread: false });
        else if (d === 0) out.push({ id: 'td:' + l.id + ':' + sid + ':' + w.next, kind: 'td', rank: 1, late: 0, title: l.name, sub: 'Follow-up', tag: 'Today', svc: sid, lead: l.id, unread: false });
      });
    });
    out.sort((a, b) => a.rank - b.rank || b.late - a.late || a.title.localeCompare(b.title));
    NOTICES.forEach((n) => {
      out.push({ id: n.id, kind: n.kind, rank: 2, late: 0, title: n.title, sub: n.sub, tag: 'New', svc: n.svc, tab: n.tab, unread: false });
    });
    out.forEach((n) => {
      n.unread = !state.read[n.id];
    });
    return out;
  }
  let ntSig = '';
  function renderNt(force?: boolean): void {
    const list = notifications();
    const unread = list.filter((n) => n.unread).length;
    const open = state.open === 'nt';
    const sig = state.user + '|' + unread + '|' + open + '|' + list.map((n) => n.id + (n.unread ? '1' : '0')).join(',');
    if (!force && sig === ntSig) return;
    ntSig = sig;
    const rows = list.filter((n) => n.unread).map((n) => {
      const s = svc(n.svc);
      return '<button type="button" class="nrow' + (n.unread ? ' unread' : '') + '" data-ntopt="' + esc(n.id) + '">' + svcIcon(s) + '<span class="ol"><span class="nt-t">' + esc(n.title) + '</span><span class="sm">' + esc(s.name) + ' · ' + esc(n.sub) + '</span></span><span class="nt-tag nt-' + n.kind + '">' + esc(n.tag) + '</span></button>';
    }).join('');
    el('nt-dd').innerHTML = '<button type="button" class="nt-btn' + (unread ? ' has' : '') + '" data-ntbtn aria-label="Notifications' + (unread ? ', ' + unread + ' unread' : '') + '" aria-haspopup="true" aria-expanded="' + open + '">' + BELL + (unread ? '<span class="nt-badge">' + (unread > 99 ? '99+' : unread) + '</span>' : '') + '</button>' +
      (open ? '<div class="pop pop-r nt-pop"><div class="nt-h"><b>Notifications</b>' + (unread ? '<button type="button" class="nt-all" data-ntall>Mark all read</button>' : '') + '</div>' + (unread ? '<div class="opts">' + rows + '</div>' : '<p class="nt-empty"><b>Nothing left</b>You are all caught up.</p>') + '</div>' : '');
  }
  function markRead(keys: string[]): void {
    const fresh = keys.filter((k) => !state.read[k]);
    fresh.forEach((k) => {
      state.read[k] = true;
    });
    if (fresh.length) api<unknown>('POST', '/api/sales/notifications/read', { keys: fresh }).catch(() => {
      /* the notice stays read on screen; the server catches up on the next change */
    });
  }
  function openNotification(id: string): void {
    const n = notifications().find((x) => x.id === id);
    if (!n) return;
    markRead([id]);
    state.open = '';
    state.service = n.svc;
    state.stageFilter = '';
    state.qf = '';
    state.showDetail = false;
    state.q = '';
    el<HTMLInputElement>('gq').value = '';
    if (n.lead) {
      state.tab = 'assigned';
      state.selected = n.lead;
      state.showDetail = true;
    } else state.tab = n.tab && isTab(n.tab) ? n.tab : 'info';
    settleBar();
    window.scrollTo(0, 0);
    render();
    animateView('tab');
    renderNt(true);
  }

  function renderWho(): void {
    const open = state.open === 'who';
    el('who-dd').innerHTML = '<button type="button" class="who-btn" data-whobtn aria-label="Account menu" aria-haspopup="menu" aria-expanded="' + open + '"><span>' + esc(self().name) + '</span>' + CHEV + '</button>' +
      (open ? '<div class="pop pop-r"><div class="sm pop-h">' + esc(DATA.me.email) + '</div><div class="opts" role="menu"><div class="sm pop-h">Theme</div>' + THEMES.map((x) => optHtml('data-setheme', x[0], x[1], '', themePref() === x[0])).join('') + '<div class="sm pop-h">Account</div>' + optHtml('data-signout', '1', 'Sign out', '', false) + '</div></div>' : '');
  }

  /* ---------- shared bits ---------- */
  function copyBtn(t: string): string {
    return t ? '<button type="button" class="copy" data-copy="' + esc(t) + '" aria-label="Copy" title="Copy"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/></svg></button>' : '';
  }
  function emailsHtml(l: Lead): string {
    return l.email.length ? l.email.map((e) => esc(e)).join('<br>') : '<span class="dash">Not found</span>';
  }
  function webHtml(l: Lead): string {
    const w = safeUrl(l.web);
    return w ? '<a href="' + esc(w) + '" target="_blank" rel="noopener noreferrer">' + esc(domain(w)) + '</a>' : '<span class="dash">No website</span>';
  }
  /* Social profile links, all together in one list (no per-site columns). Rows show the first few; details show every one. */
  function socialHtml(l: Lead): string {
    const all = (l.social || []).filter((u) => safeUrl(u));
    return all.length ? '<div class="soc">' + all.map((u) => '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(socialLabel(u)) + '</a>').join('') + '</div>' : '<span class="dash">None listed</span>';
  }
  function waHtml(l: Lead): string {
    return l.wa ? '<span class="num">+' + esc(l.wa.replace(/^(\d{2})(\d{5})(\d+)$/, '$1 $2 $3')) + '</span>' : '<span class="dash">Not listed</span>';
  }

  function keywordsHtml(l: Lead): string {
    if (!l.keywords) return '<span class="dash">—</span>';
    const parts = l.keywords.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return '<span class="dash">—</span>';
    return '<div class="kw-tags">' + parts.map((k) => '<span class="kw-tag">' + esc(k) + '</span>').join('') + '</div>';
  }

  /* ---------- Modal ---------- */
  function kv(k: string, v: string): string {
    return '<div class="kv"><dt>' + k + '</dt><dd>' + v + '</dd></div>';
  }
  function openModal(id: string): void {
    const l = byId(id);
    if (!l || W(l)) return;
    state.modal = id;
    lockScroll();
    if (isScale()) {
      const pNum = l.personalNumber || l.phone;
      const loc = [l.city, l.state, l.country].filter(Boolean).join(', ');
      const li = safeUrl(l.linkedin);
      layer.innerHTML = '<div class="scrim" id="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
        '<div class="m-head"><div><h2 id="m-title">' + esc(toTitleCase(l.name)) + '</h2><div class="sm">' + esc([jobTitleOf(l), l.company].filter(Boolean).join(' · ') || loc) + '</div></div><button class="x" id="m-x" aria-label="Close">×</button></div>' +
        '<dl>' +
        kv('Full Name', '<span style="font-weight:600">' + esc(toTitleCase(l.name)) + '</span>') +
        kv('Company', (l.company ? '<b>' + esc(toTitleCase(l.company)) + '</b>' : '<span class="dash">—</span>') + (l.web ? '<br>' + webHtml(l) : '')) +
        kv('Job Title', l.title ? esc(toTitleCase(l.title)) : '<span class="dash">—</span>') +
        kv('Email', emailsHtml(l)) +
        kv('Personal Number', pNum ? '<span class="num">' + esc(pNum) + '</span>' + copyBtn(pNum) : '<span class="dash">Not listed</span>') +
        kv('Keywords', keywordsHtml(l)) +
        (li ? kv('LinkedIn', '<a class="ext" href="' + esc(li) + '" target="_blank" rel="noopener noreferrer"><span>View LinkedIn Profile</span><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1h6v6M9 1L1 9"/></svg></a>') : '') +
        (loc ? kv('Location', esc(loc)) : '') +
        '</dl>' +
        '<div class="m-foot"><button class="btn assign m-only" id="m-go">Assign to me</button></div></div></div>';
    } else {
      layer.innerHTML = '<div class="scrim" id="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
        '<div class="m-head"><div><h2 id="m-title">' + esc(toTitleCase(l.name)) + '</h2><div class="sm">' + esc(catLabel(l.cat)) + ' · ' + esc(toTitleCase(l.area || l.city)) + '</div></div><button class="x" id="m-x" aria-label="Close">×</button></div>' +
        '<dl>' + kv('Phone', l.phone ? '<span class="num">' + esc(l.phone) + '</span>' + copyBtn(l.phone) : '<span class="dash">Not listed</span>') +
        kv('Email', emailsHtml(l)) + kv('Website', webHtml(l)) + kv('Social links', socialHtml(l)) + kv('WhatsApp', waHtml(l)) +
        kv('Address', esc(l.addr) + '<br><a href="' + esc(mapsUrl(l)) + '" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>') +
        kv('Open today', esc(todayHours(l))) + '</dl>' +
        '<div class="m-foot"><button class="btn assign m-only" id="m-go">Assign to me</button></div></div></div>';
    }
    el('m-go').focus();
    el('m-x').onclick = closeModal;
    wireScrim();
    el('m-go').onclick = () => {
      assign(id);
    };
  }
  /* Close with a slide down on phones (and a short fade on desktop), then remove it. */
  function closeModal(): void {
    unlockScroll();
    state.modal = null;
    const sc = layer.querySelector('.scrim');
    if (!sc) {
      layer.innerHTML = '';
      return;
    }
    if (prefersReducedMotion()) {
      layer.innerHTML = '';
      return;
    }
    sc.classList.add('leaving');
    setTimeout(() => {
      if (layer.querySelector('.scrim.leaving')) layer.innerHTML = '';
    }, 260);
  }

  /* Client info: phone, email, website, address and hours, shown on demand from the Assigned panel. */
  function openInfo(id: string): void {
    const l = byId(id);
    if (!l) return;
    state.modal = 'info';
    lockScroll();
    if (isScale()) {
      const pNum = l.personalNumber || l.phone;
      const loc = [l.city, l.state, l.country].filter(Boolean).join(', ');
      const li = safeUrl(l.linkedin);
      layer.innerHTML = '<div class="scrim" id="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
        '<div class="m-head"><div><h2 id="m-title">' + esc(toTitleCase(l.name)) + '</h2><div class="sm">' + esc([jobTitleOf(l), l.company].filter(Boolean).join(' · ') || loc) + '</div></div><button class="x" id="m-x" aria-label="Close">×</button></div>' +
        '<dl>' +
        kv('Full Name', '<span style="font-weight:600">' + esc(toTitleCase(l.name)) + '</span>') +
        kv('Company', (l.company ? '<b>' + esc(toTitleCase(l.company)) + '</b>' : '<span class="dash">—</span>') + (l.web ? '<br>' + webHtml(l) : '')) +
        kv('Job Title', l.title ? esc(toTitleCase(l.title)) : '<span class="dash">—</span>') +
        kv('Email', emailsHtml(l)) +
        kv('Personal Number', pNum ? '<span class="num">' + esc(pNum) + '</span>' + copyBtn(pNum) : '<span class="dash">Not listed</span>') +
        kv('Keywords', keywordsHtml(l)) +
        (li ? kv('LinkedIn', '<a class="ext" href="' + esc(li) + '" target="_blank" rel="noopener noreferrer"><span>View LinkedIn Profile</span><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1h6v6M9 1L1 9"/></svg></a>') : '') +
        (loc ? kv('Location', esc(loc)) : '') +
        '</dl></div></div>';
    } else {
      layer.innerHTML = '<div class="scrim" id="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
        '<div class="m-head"><div><h2 id="m-title">' + esc(toTitleCase(l.name)) + '</h2><div class="sm">' + esc(catLabel(l.cat)) + ' · ' + esc(toTitleCase(l.area || l.city)) + '</div></div><button class="x" id="m-x" aria-label="Close">×</button></div>' +
        '<dl>' + kv('Phone', l.phone ? '<span class="num">' + esc(l.phone) + '</span>' + copyBtn(l.phone) : '<span class="dash">Not listed</span>') +
        kv('WhatsApp', waHtml(l)) + kv('Email', emailsHtml(l)) + kv('Website', webHtml(l)) + kv('Social links', socialHtml(l)) +
        kv('Address', esc(l.addr) + '<br><a href="' + esc(mapsUrl(l)) + '" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>') +
        kv('Open today', esc(todayHours(l))) + '</dl></div></div>';
    }
    el('m-x').focus();
    el('m-x').onclick = closeModal;
    wireScrim();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.modal) closeModal();
    else if (state.open) setOpen('');
  });

  let assigning = false;
  function dropOpen(l: Lead, wsId: string): void {
    l.open = l.open.filter((x) => x !== wsId);
  }
  function assign(id: string): void {
    const l = byId(id);
    const wsId = state.service;
    if (assigning) return;
    if (!l || W(l) || l.open.indexOf(wsId) < 0) {
      closeModal();
      toast('That store was just claimed by someone else.');
      render();
      return;
    }
    assigning = true;
    api<Claim>('POST', '/api/sales/claims', { leadId: id, workspaceId: wsId }).then((created) => {
      assigning = false;
      dropOpen(l, wsId);
      l.work[wsId] = created;
      closeModal();
      state.selected = id;
      state.showDetail = true;
      state.tab = 'assigned';
      state.q = '';
      el<HTMLInputElement>('gq').value = '';
      render();
    }).catch((e: unknown) => {
      assigning = false;
      closeModal();
      if (statusOf(e) === 409) {
        dropOpen(l, wsId);
        failToast(e);
        render();
      } else failToast(e);
    });
  }

  /* ---------- Assigned tab: a work queue ---------- */
  function saveClaim(l: Lead | undefined, patch: ClaimPatch, done?: () => void): void {
    const w = l && l.work[state.service];
    if (!l || !w) return;
    api<Claim>('PATCH', '/api/sales/claims/' + w.id, patch).then((dto) => {
      l.work[state.service] = dto;
      renderAssigned();
      chrome();
      if (done) done();
    }).catch(failToast);
  }

  function groupOf(l: Lead): string {
    const w = claim(l);
    if (w.status === 'Won' || w.status === 'Lost') return 'closed';
    if (!w.next) return 'none';
    const d = diffDays(w.next);
    return d < 0 ? 'od' : (d === 0 ? 'today' : 'later');
  }
  function queue(list: Lead[]): QueueGroup[] {
    const out: QueueGroup[] = [];
    GROUPS_Q.forEach((g) => {
      const items = list.filter((l) => groupOf(l) === g[0]);
      items.sort((a, b) => {
        const x = claim(a);
        const y = claim(b);
        if (g[0] === 'od' || g[0] === 'later' || g[0] === 'today') return x.next < y.next ? -1 : (x.next > y.next ? 1 : a.name.localeCompare(b.name));
        if (g[0] === 'closed') return y.last - x.last;
        return a.name.localeCompare(b.name);
      });
      if (items.length) out.push({ key: g[0], title: g[1], items });
    });
    return out;
  }

  function qfMatch(key: string): boolean {
    if (!state.qf) return true;
    return state.qf === 'later' ? (key === 'later' || key === 'none') : state.qf === key;
  }

  function waLink(l: Lead): string {
    return waLinkOf(l.wa, l.phone);
  }
  function actBtn(href: string, kind: string, label: string, ext?: boolean): string {
    const tile = tileOf(kind);
    return href ? '<a class="actb" href="' + esc(href) + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + tile + label + '</a>' : '<span class="actb off">' + tile + label + '</span>';
  }

  function renderAssigned(): void {
    const draftEl = maybeEl('note', HTMLTextAreaElement);
    const draft = draftEl ? draftEl.value : '';
    const owned = mine();
    const counts: Record<string, number> = {};
    ALLSTAGES.forEach((s) => {
      counts[s] = 0;
    });
    owned.forEach((l) => {
      counts[claim(l).status]++;
    });
    const list = owned.filter((l) => matchQ(l) && (!state.stageFilter || claim(l).status === state.stageFilter));


    let h = '<div class="head' + (state.showDetail ? ' head-d' : '') + '">' + (state.showDetail ? '<button type="button" class="head-back" data-back aria-label="Back to the Assigned list"><svg viewBox="0 0 8 14" aria-hidden="true"><path d="M7 1L1 7l6 6"/></svg></button>' : '') + '<h1>Assigned</h1><span class="sub">' + esc(svcName()) + '</span></div>';
    if (!list.length) {
      view.innerHTML = h + '<div class="tablewrap"><div class="empty"><b>' + (owned.length ? 'No leads match' : 'Nothing assigned yet') + '</b>' + (owned.length ? 'Clear the search or the stage filter.' : 'Open Leads and assign a lead to yourself.') + '</div></div>';
      return;
    }
    const all = queue(list);
    const groups = all.filter((g) => qfMatch(g.key));
    let flat: Lead[] = [];
    groups.forEach((g) => {
      flat = flat.concat(g.items);
    });
    if (!flat.length) {
      view.innerHTML = h + '<div class="tablewrap"><div class="empty"><b>Nothing here</b></div></div>';
      return;
    }
    if (!state.selected || !flat.some((l) => l.id === state.selected)) state.selected = flat[0].id;
    const cur = byId(state.selected) ?? flat[0];
    let n = 0;
    const body = groups.map((g) => {
      const closed = g.key === 'closed';
      if (closed) n = 0; /* closed leads are numbered from 1 on their own */
      const head = closed ? '<button type="button" class="qsec closed-t" data-closedtoggle aria-expanded="' + state.closedOpen + '">Closed · ' + g.items.length + CHEV + '</button>' : '<div class="qsec' + (g.key === 'od' ? ' od' : '') + '">' + g.title + ' · ' + g.items.length + '</div>';
      return head + g.items.map((l) => {
        const w = claim(l);
        n++;
        const fu = '<span class="fu ' + (closed ? '' : g.key) + '">' + (closed || !w.next ? '' : esc(fuText(w.next))) + '</span>';
        const hasAct = (g.key === 'od' || g.key === 'today');
        const pNum = isScale() ? (l.personalNumber || l.phone) : l.phone;
        const dg = pNum ? pNum.replace(/\D/g, '') : '';
        const wl = waLink(l);
        const subTxt = isScale() ? (esc([jobTitleOf(l), l.company].filter(Boolean).join(' · ') || l.city)) : esc(l.area || l.city);
        const acts = hasAct ? '<span class="act2">' + (dg ? '<a class="a2" href="tel:+' + dg + '" aria-label="Call ' + esc(toTitleCase(l.name)) + '">' + tileOf('call') + '</a>' : '') + (wl ? '<a class="a2" href="' + esc(wl) + '" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp ' + esc(toTitleCase(l.name)) + '">' + tileOf('whatsapp') + '</a>' : '') + '</span>' : '';
        return '<div class="item-wrap' + (hasAct ? ' has-act' : '') + (closed ? ' closed-item' : '') + '"><button class="item" role="listitem" data-pick="' + l.id + '" aria-current="' + (l.id === state.selected) + '"><span class="no num">' + n + '</span>' +
          '<span class="name">' + esc(toTitleCase(l.name)) + '</span><span class="m-sub">' + subTxt + '</span><span class="st">' + assignedStagePreview(w) + '</span><span class="stgt" aria-label="Current stage is ' + esc(SL(w.status)) + '">' + assignedStagePreview(w) + '</span>' + fu + '<span class="last">' + esc(ucfirst(agoText(w.last))) + '</span></button>' + acts + '</div>';
      }).join('');
    }).join('');
    h += '<div class="split' + (state.showDetail ? ' show-detail' : '') + '"><div class="list' + (state.closedOpen ? ' closed-open' : '') + '" role="list"><div class="qhead" aria-hidden="true"><span>Sr.</span><span>' + (isScale() ? 'Lead' : 'Store') + '</span><span>Stage</span><span>Follow-up</span><span class="c-last">Last touched</span><span></span></div>' + body + '</div>' + detail(cur) + '</div>';
    view.innerHTML = h;
    const ta = maybeEl('note', HTMLTextAreaElement);
    if (ta && draft) ta.value = draft;
  }

  /* A small calendar so the follow-up date reads "21 Nov (Sat)" and the picker looks like the rest of the app. */
  function calHtml(sel: string): string {
    const ym = state.calMonth || (sel || dayOffset(0)).slice(0, 7);
    const y = parseInt(ym.slice(0, 4), 10);
    const m = parseInt(ym.slice(5, 7), 10) - 1;
    const first = new Date(y, m, 1);
    const lead = (first.getDay() + 6) % 7;
    const dim = new Date(y, m + 1, 0).getDate();
    const today = dayOffset(0);
    const title = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    let h = '<div class="cal-h"><button type="button" class="cal-nav" data-calnav="-1" aria-label="Previous month"><svg viewBox="0 0 6 10" aria-hidden="true"><path d="M5 1L1 5l4 4"/></svg></button><span>' + esc(title) + '</span><button type="button" class="cal-nav" data-calnav="1" aria-label="Next month"><svg viewBox="0 0 6 10" aria-hidden="true"><path d="M1 1l4 4-4 4"/></svg></button></div>';
    h += '<div class="cal-w">' + CAL_DAYS.map((d) => '<span>' + d + '</span>').join('') + '</div><div class="cal-g">';
    for (let i = 0; i < lead; i++) h += '<span></span>';
    for (let d = 1; d <= dim; d++) {
      const key = y + '-' + pad2(m + 1) + '-' + pad2(d);
      h += '<button type="button" class="cal-d' + (key === sel ? ' sel' : '') + (key === today ? ' today' : '') + '" data-day="' + key + '"' + (key === sel ? ' aria-pressed="true"' : '') + '>' + d + '</button>';
    }
    return h + '</div>';
  }

  /* Activity is kept per stage: every stage the lead has reached gets its own block with optional notes. */
  function stageBlocks(w: Claim): string[] {
    const idx = STAGES.indexOf(w.status);
    const lost = w.status === 'Lost';
    const reached = lost ? STAGES.slice(0, 1).concat(STAGES.filter((s) => w.comments.some((c) => c.stage === s))).filter((s, i, a) => a.indexOf(s) === i).concat(['Lost']) : STAGES.slice(0, idx + 1);
    return reached.reverse();
  }
  function reachedAt(w: Claim, s: string): number {
    let at = 0;
    (w.history || []).forEach((h) => {
      if (h.s === s && h.t > at) at = h.t;
    });
    return at;
  }
  function stageBlock(w: Claim, s: string): string {
    const open = has(state.stgOpen, s) ? state.stgOpen[s] : s === w.status;
    const items = w.comments.filter((c) => c.stage === s && c.by !== 'sys');
    const notes = items.filter((c) => c.by !== 'sys').length;
    let h = '<section class="sb' + (s === w.status ? ' cur' : '') + '"><button type="button" class="sb-h" data-stgtoggle="' + s + '" aria-expanded="' + open + '"><span class="st ' + sclass(s) + '">' + esc(SL(s)) + '</span>' +
      '<span class="sb-n">' + (notes ? notes + (notes === 1 ? ' note' : ' notes') : 'No notes') + (reachedAt(w, s) ? ' · ' + esc(fmtAt(reachedAt(w, s))) : '') + '</span>' + CHEV + '</button>';
    if (open) {
      h += '<div class="sb-b">';
      if (state.logStage === s) {
        h += '<div class="logbox"><textarea id="note" aria-label="Note for ' + esc(SL(s)) + '" placeholder="Add a note for ' + esc(SL(s)) + ' (optional)"></textarea><div class="compose-act"><span class="sm">Optional. Visible to you and admins</span><button class="btn assign" id="post">Add note</button></div></div>';
      } else {
        h += '<button type="button" class="addnote" data-addnote="' + s + '">Add a note</button>';
      }
      if (items.length) {
        h += '<ul class="tline">' + items.slice().reverse().map((c) => {
          const sys = c.by === 'sys';
          const u = sys ? null : user(c.by);
          return '<li class="tle' + (sys ? ' sys' : '') + '"><div class="c-meta"><b>' + (sys ? 'System' : esc(u ? u.name : 'Teammate')) + '</b><span>' + esc(fmtAt(c.at)) + '</span></div><p class="c-body">' + esc(sys ? sysText(c.text) : c.text) + '</p></li>';
        }).join('') + '</ul>';
      }
      h += '</div>';
    }
    return h + '</section>';
  }

  const MQ_PHONE = media('(max-width:820px)');
  function isPhone(): boolean {
    return !!(MQ_PHONE && MQ_PHONE.matches);
  }

  /* ---------- theme: light (default), dark, or follow the device ---------- */
  function themePref(): string {
    try {
      return localStorage.getItem('ld_theme') || 'light';
    } catch {
      return 'light';
    }
  }
  function applyTheme(): void {
    const p = themePref();
    const dark = p === 'dark' || (p === 'system' && !!media('(prefers-color-scheme: dark)')?.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
  let themeTimer: number | undefined;
  function setTheme(p: string): void {
    try {
      localStorage.setItem('ld_theme', p);
    } catch {
      /* the choice still applies for this visit */
    }
    const root = document.documentElement;
    /* change the theme on the elements already on screen so their colours can fade; no redraw */
    root.classList.add('theme-fade');
    applyTheme();
    document.querySelectorAll<HTMLElement>('[data-setheme]').forEach((b) => {
      if (b.classList.contains('pf-seg-b') || (b.parentNode instanceof Element && b.parentNode.classList.contains('pf-seg'))) b.setAttribute('aria-pressed', String(b.dataset.setheme === p));
    });
    if (state.open === 'who') setOpen('');
    clearTimeout(themeTimer);
    themeTimer = window.setTimeout(() => {
      root.classList.remove('theme-fade');
    }, 550);
  }
  try {
    media('(prefers-color-scheme: dark)')?.addEventListener('change', () => {
      if (themePref() === 'system') applyTheme();
    });
  } catch {
    /* an old browser without change events on media queries just keeps the theme chosen at load */
  }
  let movingStage = false;
  /* classes for the six steps of the stage line: d = done, c = current */
  function stepClsFor(status: string, w: Claim): string[] {
    const idx = STAGES.indexOf(status);
    const lost = status === 'Lost';
    const won = status === 'Won';
    const reached = stageBlocks(w);
    return STAGES.map((s, i) => {
      return lost ? (reached.indexOf(s) > -1 ? 'd' : '') : (won || i < idx ? 'd' : (i === idx ? 'c' : ''));
    });
  }
  /* Phone: show the new stage straight away by changing the existing elements, so only cheap properties animate. */
  function liveStage(w: Claim, ns: string): void {
    const cls = stepClsFor(ns, w);
    const idx = STAGES.indexOf(ns);
    const dots = document.querySelectorAll<HTMLElement>('.stp .stn');
    const lines = document.querySelectorAll<HTMLElement>('.stp .stl');
    const from = STAGES.indexOf(w.status);
    const fwd = idx > from;
    const STEP = 0.3;
    cls.forEach((c, k) => {
      const s = k - from;
      const moving = fwd && k > from && k <= idx;
      dots[k].style.transitionDelay = (moving ? s * STEP : 0) + 's';
      if (k) {
        lines[k - 1].style.setProperty('--ld', (moving ? (s - 1) * STEP : 0) + 's');
        lines[k - 1].className = 'stl' + (c ? ' on' : '');
      }
      dots[k].className = 'stn' + (c ? ' ' + c : '');
    });
    const cur = document.querySelector('.mst-cur');
    if (cur) {
      cur.className = 'st mst-cur ' + sclass(ns);
      cur.textContent = ns;
    }
    const cnt = document.querySelector('.mstage .mst-row .sm');
    if (cnt) cnt.textContent = (idx + 1) + ' of ' + STAGES.length;
    const pop = document.querySelector('.mst-chg .pop');
    if (pop) pop.remove();
    const ta = maybeEl('note', HTMLTextAreaElement);
    if (ta) {
      ta.placeholder = 'Add a note for ' + ns + ' (optional)';
      ta.setAttribute('aria-label', 'Note for ' + ns);
    }
    const btn = document.querySelector<HTMLElement>('.mnext');
    const nxt = (ns !== 'Won' && idx < STAGES.length - 1) ? STAGES[idx + 1] : '';
    if (btn) {
      if (nxt) {
        btn.dataset.stageopt = nxt;
        btn.textContent = 'Move to ' + SL(nxt) + ' →';
      } else btn.remove();
    }
    state.open = '';
  }
  function stepsHtml(cls: string[]): string {
    return cls.map((c, i) => {
      return (i ? '<span class="stl' + (c ? ' on' : '') + '"></span>' : '') + '<span class="stn' + (c ? ' ' + c : '') + '"></span>';
    }).join('');
  }
  function phoneStage(w: Claim, stageOpts: string): string {
    const idx = STAGES.indexOf(w.status);
    const lost = w.status === 'Lost';
    const won = w.status === 'Won';
    const steps = stepsHtml(stepClsFor(w.status, w));
    const next = (!won && !lost && idx < STAGES.length - 1) ? STAGES[idx + 1] : '';
    const chg = '<div class="combo mst-chg"><button type="button" class="chg" data-stagebtn aria-haspopup="listbox" aria-expanded="' + (state.open === 'stage') + '">Change' + CHEV + '</button>' +
      (state.open === 'stage' ? '<div class="pop pop-r"><div class="opts" role="listbox">' + stageOpts + '</div></div>' : '') + '</div>';
    return '<div class="mstage"><div class="k">Stage</div><div class="stp" aria-hidden="true">' + steps + '</div>' +
      '<div class="mst-row"><span class="st mst-cur ' + sclass(w.status) + '">' + esc(SL(w.status)) + '</span><span class="sm">' + (lost ? 'Closed' : (idx + 1) + ' of ' + STAGES.length) + '</span>' + chg + '</div>' +
      (next ? '<button type="button" class="btn assign mnext" data-stageopt="' + next + '">Move to ' + SL(next) + ' →</button>' : '') + '</div>';
  }
  /* One entry per stage move, newest first. Notes hang off the stage move they were written in. */
  function activityItems(w: Claim): ActivityItem[] {
    const items: ActivityItem[] = (w.history || []).map((h, i) => ({ stage: h.s, t: h.t, i, notes: [] }));
    w.comments.forEach((c) => {
      if (c.by === 'sys') return;
      let host: ActivityItem | null = null;
      for (const it of items) {
        if (it.stage === c.stage && it.t <= c.at && (!host || it.t >= host.t)) host = it;
      }
      if (!host) {
        for (const it of items) {
          if (it.stage === c.stage && (!host || it.t >= host.t)) host = it;
        }
      }
      if (!host) {
        host = { stage: c.stage, t: c.at, i: items.length, notes: [] };
        items.push(host);
      }
      host.notes.push({ id: c.id, text: c.text, t: c.at, edited: c.edited });
    });
    items.sort((a, b) => b.t - a.t || b.i - a.i);
    return items;
  }
  function noteHtml(x: ActivityItem['notes'][number]): string {
    return '<div class="tl2-note" data-nid="' + x.id + '"><p class="c-body">' + esc(x.text) + (x.edited ? ' <span class="sm">(edited)</span>' : '') + '</p><button type="button" class="note-edit" data-noteedit="' + x.id + '">Edit</button></div>';
  }
  function activityList(items: ActivityItem[]): string {
    return '<ul class="tl2">' + items.map((it) => {
      return '<li><span class="sd ' + sclass(it.stage) + '"></span><div class="tl2-h"><span class="tl2-t"><b>' + esc(SL(it.stage)) + '</b><span class="sm">' + esc(fmtAt(it.t)) + '</span></span></div>' +
        (it.notes.length ? '<div class="tl2-notes">' + it.notes.map(noteHtml).join('') + '</div>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function findNote(id: number): FoundNote | null {
    for (let a = 0; a < LEADS.length; a++) {
      const keys = Object.keys(LEADS[a].work);
      for (let b = 0; b < keys.length; b++) {
        const cs = LEADS[a].work[keys[b]].comments;
        for (let c = 0; c < cs.length; c++) if (cs[c].id === id) return { lead: LEADS[a], svc: keys[b], note: cs[c] };
      }
    }
    return null;
  }
  /* redraw the timeline in place, on the page and in the Show all popup, without touching anything else */
  function refreshActivity(): void {
    const l = byId(state.selected);
    const w = l && W(l);
    if (!w) return;
    const ul = document.querySelector('.detail .d-sec .tl2');
    if (ul) ul.outerHTML = activityList(activityItems(w).slice(0, 5));
    const pu = document.querySelector('#layer .flow-body .tl2');
    if (pu) pu.outerHTML = activityList(activityItems(w).reverse());
  }
  function startEdit(id: number): void {
    const found = findNote(id);
    const box = document.querySelector<HTMLElement>('.tl2-note[data-nid="' + id + '"]');
    if (!found || !box) return;
    document.querySelectorAll('.tl2-note.editing').forEach((b) => {
      b.classList.remove('editing');
    });
    box.classList.add('editing');
    box.innerHTML = '<textarea class="note-ta" aria-label="Edit note" maxlength="2000"></textarea><div class="note-act"><button type="button" class="btn" data-notecancel>Cancel</button><button type="button" class="btn assign" data-notesave>Save</button></div>';
    const ta = box.querySelector('textarea');
    if (!ta) return;
    ta.value = found.note.text;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  function saveEdit(box: HTMLElement): void {
    const id = parseInt(ds(box, 'nid'), 10);
    const found = findNote(id);
    const ta = box.querySelector('textarea');
    const btn = box.querySelector<HTMLButtonElement>('[data-notesave]');
    if (!found || !ta || !btn) return;
    const text = ta.value.trim();
    if (!text) {
      toast('Write a note first.');
      ta.focus();
      return;
    }
    if (text === found.note.text) {
      refreshActivity();
      return;
    }
    btn.disabled = true;
    api<Claim>('PATCH', '/api/sales/notes/' + id, { text }).then((dto) => {
      found.lead.work[found.svc] = dto;
      refreshActivity();
    }).catch((e: unknown) => {
      btn.disabled = false;
      failToast(e);
    });
  }

  function phoneActivity(w: Claim): string {
    const items = activityItems(w);
    const box = '<div class="logbox pn"><textarea id="note" aria-label="Note for ' + esc(SL(w.status)) + '" placeholder="Add a note for ' + esc(SL(w.status)) + ' (optional)"></textarea><div class="compose-act end"><button class="btn assign" id="post">Add note</button></div></div>';
    return '<div class="d-sec">' + box + '<div class="act-row"><h3 class="act-h">Activity</h3><button type="button" class="act-all" data-flow>Show all</button></div>' +
      activityList(items.slice(0, 5)) + '</div>';
  }
  /* Every stage move and note from the start to now. */
  function openFlow(id: string | null): void {
    const l = byId(id);
    const w = l && W(l);
    if (!l || !w) return;
    state.modal = 'flow';
    lockScroll();
    layer.innerHTML = '<div class="scrim" id="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
      '<div class="m-head"><div><h2 id="m-title">Activity</h2><div class="sm">' + esc(toTitleCase(l.name)) + '</div></div><button class="x" id="m-x" aria-label="Close">×</button></div>' +
      '<div class="flow-body">' + activityList(activityItems(w).reverse()) + '</div></div></div>';
    el('m-x').focus();
    el('m-x').onclick = closeModal;
    wireScrim();
  }

  function detail(l: Lead): string {
    const w = claim(l);
    const idx = STAGES.indexOf(w.status);
    const lost = w.status === 'Lost';
    const won = w.status === 'Won';
    if (state.stgLead !== l.id) {
      state.stgLead = l.id;
      state.logStage = w.status;
      state.stgOpen = {};
    }
    if (!stageBlocks(w).some((s) => s === state.logStage)) state.logStage = w.status;
    if (isPhone()) state.logStage = w.status;
    const pNum = isScale() ? (l.personalNumber || l.phone) : l.phone;
    const digits = pNum ? pNum.replace(/\D/g, '') : '';
    const mailHref = (isScale() && l.email.length) ? 'mailto:' + encodeURIComponent(l.email[0]) : '';
    const acts = '<div class="acts">' + actBtn(digits ? 'tel:+' + digits : '', 'call', 'Call') + actBtn(waLink(l), 'whatsapp', 'WhatsApp', true) + (mailHref ? actBtn(mailHref, 'mail', 'Email') : '') + '</div>';
    const prog = '<div class="prog' + (won ? ' won' : '') + (lost ? ' lost' : '') + '" aria-hidden="true">' + STAGES.map((_s, i) => '<i' + ((won || lost || i <= idx) ? ' class="f"' : '') + '></i>').join('') + '</div>';
    const stageOpts = ALLSTAGES.map((s) => optHtml('data-stageopt', s, SL(s), '', s === w.status, false, '<span class="sd ' + sclass(s) + '"></span>')).join('');
    const stageBox = '<div class="combo"><button type="button" class="field combo-btn" data-stagebtn aria-haspopup="listbox" aria-expanded="' + (state.open === 'stage') + '"><span><span class="sd ' + sclass(w.status) + '"></span>' + esc(SL(w.status)) + '</span>' + CHEV + '</button>' +
      (state.open === 'stage' ? '<div class="pop"><div class="opts" role="listbox">' + stageOpts + '</div></div>' : '') + '</div>';
    const fuBox = (won || lost) ? '<span class="sm">Closed</span>' :
      '<div class="fuw"><div class="combo"><button type="button" class="field combo-btn fu-btn" data-fubtn aria-haspopup="dialog" aria-expanded="' + (state.open === 'fu') + '"><span class="' + (w.next ? '' : 'ph') + '">' + (w.next ? esc(fuFull(w.next)) : 'Pick a date') + '</span>' + ico('cal') + '</button>' + (state.open === 'fu' ? '<div class="pop cal">' + calHtml(w.next) + '</div>' : '') + '</div><div class="fq"><button type="button" data-fu="1">Tomorrow</button><button type="button" data-fu="3">In 3 days</button><button type="button" data-fu="7">Next week</button>' + (w.next ? '<button type="button" data-fu="clear">Clear</button>' : '') + '</div></div>';
    const detailSub = isScale() ? (esc([jobTitleOf(l), l.company].filter(Boolean).join(' · ') || l.city)) : esc(l.area || l.city);
    return '<div class="detail">' +
      '<button type="button" class="drawer-x" data-back aria-label="Close panel">×</button>' +
      '<div class="d-head"><div><h1>' + (isPhone() ? '<button type="button" class="d-back" data-back aria-label="Back to the Assigned list"><svg viewBox="0 0 8 14" aria-hidden="true"><path d="M7 1L1 7l6 6"/></svg></button>' : '') + esc(toTitleCase(l.name)) + '<button type="button" class="info-i" data-info="' + l.id + '" aria-label="' + (isScale() ? 'Lead info' : 'Store info') + '" title="' + (l.email.length ? esc(l.email.join(', ')) : (pNum || '')) + '">' + tileOf('info') + '</button></h1><div class="sm">' + detailSub + ' · Last touched ' + esc(agoText(w.last)) + '</div></div></div>' +
      acts +
      (isPhone()
        ? phoneStage(w, stageOpts) + '<div class="sf"><div><div class="k">Next follow-up</div>' + fuBox + '</div></div>' + phoneActivity(w) + '</div>'
        : '<div class="sf"><div><div class="k">Stage</div>' + stageBox + prog + '</div><div><div class="k">Next follow-up</div>' + fuBox + '</div></div>' +
          '<div class="d-sec"><h3>Activity by stage</h3>' + stageBlocks(w).map((s) => stageBlock(w, s)).join('') + '</div></div>');
  }

  /* ---------- Profile (phone bottom bar) ---------- */
  function pfRow(icon: string, label: string, right: string, attrs: string, cls?: string): string {
    return '<button type="button" class="pf-row' + (cls ? ' ' + cls : '') + '" ' + attrs + '>' + icon + '<span class="pf-l">' + label + '</span>' + (right || '') + pi('chev', 'pf-chev') + '</button>';
  }
  function renderProfile(): void {
    const u = self();
    const s = svc(state.service);
    const start = periodStart('month');
    const m = mine();
    const contacted = m.filter((l) => leftNewIn(l, start)).length;
    const won = m.filter((l) => enteredIn(l, 'Won', start)).length;
    const unread = notifications().filter((n) => n.unread).length;
    const services = SERVICES.map((x) => {
      const free = LEADS.filter((l) => l.open.indexOf(x.id) > -1).length;
      const mineN = LEADS.filter((l) => l.work[x.id] && l.work[x.id].owner === state.user).length;
      return '<button type="button" class="pf-row" data-wsopt="' + esc(x.id) + '" aria-pressed="' + (x.id === state.service) + '">' + svcIcon(x) + '<span class="pf-l"><span>' + esc(x.name) + '</span><span class="sm">' + free + ' open · ' + mineN + ' assigned</span></span>' + (x.id === state.service ? CHECK : '') + '</button>';
    }).join('');
    view.innerHTML = '<div class="pf">' +
      '<div class="pf-card"><span class="pav" aria-hidden="true">' + esc(u.ini) + '</span><div class="pf-who"><b>' + esc(u.name) + '</b><span class="sm">' + esc(DATA.me.email) + '</span><span class="sm">Salesperson</span></div></div>' +
      statStrip(m.filter((l) => assignedIn(l, start)).length, contacted, won, true, 'This month in ' + s.name) +
      '<p class="pf-cap">This month · ' + esc(s.name) + '</p>' +
      '<h3 class="pf-h">Services</h3><div class="pf-list">' + services + '</div>' +
      '<h3 class="pf-h">Work</h3><div class="pf-list">' +
        pfRow(ptile('note'), '<span>My notes</span><span class="sm">' + allNotes().length + (allNotes().length === 1 ? ' note' : ' notes') + '</span>', '', 'data-pf="notes"') +
        pfRow(ptile('chart'), '<span>Monthly report</span><span class="sm">Your numbers, month by month</span>', '', 'data-pf="report"') + '</div>' +
      '<h3 class="pf-h">Appearance</h3><div class="pf-list"><div class="pf-row pf-theme">' + ptile('theme') + '<span class="pf-l"><span>Theme</span></span><span class="pf-seg" role="group" aria-label="Theme">' + THEMES.map((x) => '<button type="button" data-setheme="' + x[0] + '" aria-pressed="' + (themePref() === x[0]) + '">' + x[1] + '</button>').join('') + '</span></div></div>' +
      '<h3 class="pf-h">Account</h3><div class="pf-list">' +
        '<div class="combo">' + pfRow(ptile('bell'), '<span>Notifications</span>', unread ? '<span class="pf-n">' + unread + '</span>' : '', 'data-pf="notifications"') + '</div>' +
        pfRow(ptile('key'), '<span>Change password</span>', '', 'data-pf="password"') +
        pfRow(ptile('devices'), '<span>Sign out of all devices</span>', '', 'data-pf="signall"') +
        pfRow(ptile('logout'), '<span>Sign out</span>', '', 'data-signout', 'pf-out') +
      '</div></div>';
  }

  /* every note this person wrote, across all their services, newest first */
  function allNotes(): OwnNote[] {
    const out: OwnNote[] = [];
    LEADS.forEach((l) => {
      Object.keys(l.work).forEach((sid) => {
        l.work[sid].comments.forEach((c) => {
          if (c.by === state.user) out.push({ lead: l, svc: sid, stage: c.stage, text: c.text, at: c.at });
        });
      });
    });
    return out.sort((a, b) => b.at - a.at);
  }
  function sheet(title: string, sub: string, body: string): void {
    state.modal = 'sheet';
    lockScroll();
    layer.innerHTML = '<div class="scrim" id="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
      '<div class="m-head"><div><h2 id="m-title">' + esc(title) + '</h2>' + (sub ? '<div class="sm" id="sh-sub">' + sub + '</div>' : '') + '</div><button class="x" id="m-x" aria-label="Close">×</button></div>' + body + '</div></div>';
    el('m-x').onclick = closeModal;
    wireScrim();
  }
  function noteItems(q: string): string {
    const s = (q || '').trim().toLowerCase();
    const list = allNotes().filter((n) => !s || (n.text + ' ' + n.lead.name).toLowerCase().indexOf(s) > -1);
    if (!list.length) return '<p class="sm nt-none">' + (s ? 'No notes match.' : 'You have not written any notes yet. Add one from a lead in Assigned.') + '</p>';
    return list.slice(0, 100).map((n, i) => {
      const sv = svcById(n.svc);
      return '<button type="button" class="nt-item" data-noteopen="' + esc(n.lead.id) + '|' + esc(n.svc) + '"><span class="nt-no num">' + (i + 1) + '</span><span class="nt-body"><span class="nt-top"><b>' + esc(toTitleCase(n.lead.name)) + '</b><span class="sm">' + esc(fmtAt(n.at)) + '</span></span><span class="sm">' + esc(n.stage) + (sv ? ' · ' + esc(sv.name) : '') + '</span><span class="nt-text">' + esc(n.text) + '</span></span></button>';
    }).join('');
  }
  function openNotes(): void {
    const n = allNotes().length;
    sheet('My notes', n + (n === 1 ? ' note' : ' notes'), '<div class="flow-body"><input class="pwf nt-search" id="nt-q" type="search" placeholder="Search notes" aria-label="Search notes" autocomplete="off"><div id="nt-list">' + noteItems('') + '</div></div>');
    qs('#layer .modal').classList.add('tall');
    const search = el<HTMLInputElement>('nt-q');
    search.addEventListener('input', () => {
      el('nt-list').innerHTML = noteItems(search.value);
    });
    el('nt-list').addEventListener('click', (e) => {
      const b = closestOf(e, '[data-noteopen]');
      if (!b) return;
      const k = ds(b, 'noteopen').split('|');
      closeModal();
      state.service = k[1];
      state.tab = 'assigned';
      state.selected = k[0];
      state.showDetail = true;
      state.q = '';
      state.open = '';
      el<HTMLInputElement>('gq').value = '';
      settleBar();
      window.scrollTo(0, 0);
      render();
      animateView('tab');
    });
  }

  const NOWM = new Date();
  let reportM = monthKey(NOWM.getFullYear(), NOWM.getMonth());
  function openReport(month: string | null): void {
    if (month) reportM = month;
    const cur = monthKey(NOWM.getFullYear(), NOWM.getMonth());
    sheet('Monthly report', '', '<div class="flow-body" id="rp-body"><p class="sm">One moment</p></div>');
    qs('#layer .modal').classList.add('tall');
    api<Report>('GET', '/api/sales/report?month=' + reportM).then((r) => {
      const tot = r.totals;
      const body =
        '<div class="rp-month" role="group" aria-label="Month"><button type="button" class="rep-arrow" data-rpm="-1" aria-label="Previous month"><svg viewBox="0 0 8 14" aria-hidden="true"><path d="M7 1L1 7l6 6"/></svg></button><b>' + esc(r.label) + '</b>' +
        '<button type="button" class="rep-arrow" data-rpm="1" aria-label="Next month"' + (reportM >= cur ? ' disabled' : '') + '><svg viewBox="0 0 8 14" aria-hidden="true"><path d="M1 1l6 6-6 6"/></svg></button></div>' +
        '<div class="pf-stats four"><div><b class="num">' + tot.assigned + '</b><span>Assigned</span></div><div><b class="num">' + tot.contacted + '</b><span>Contacted</span></div><div><b class="num">' + tot.meetings + '</b><span>Meetings</span></div><div><b class="num">' + tot.won + '</b><span>Won</span></div></div>' +
        '<p class="pf-cap">Interested ' + tot.interested + ' · Negotiation ' + tot.negotiation + ' · Lost ' + tot.lost + ' · Open now ' + tot.openNow + '</p>' +
        '<h3 class="rp-h">By service</h3>' + (r.services.length ? r.services.map((s) => {
          const sv = SERVICES.find((x) => x.name === s.service);
          return '<div class="rp-row">' + (sv ? svcIcon(sv) : '') + '<span class="rp-l"><b>' + esc(s.service) + '</b><span class="sm">Assigned ' + s.assigned + ' · Contacted ' + s.contacted + ' · Meetings ' + s.meetings + ' · Won ' + s.won + '</span></span></div>';
        }).join('') : '<p class="sm">No services yet.</p>') +
        '<h3 class="rp-h">Last 6 months</h3>' + r.history.map((h) => {
          return '<button type="button" class="rp-hist' + (h.month === r.month ? ' on' : '') + '" data-rpmonth="' + esc(h.month) + '"><b>' + esc(h.label) + '</b><span class="sm">' + h.assigned + ' assigned · ' + h.contacted + ' contacted · ' + h.meetings + ' meetings · ' + h.won + ' won</span></button>';
        }).join('');
      const box = document.getElementById('rp-body');
      if (!box) return;
      box.innerHTML = body;
      box.classList.remove('rp-in');
      void box.offsetWidth;
      box.classList.add('rp-in');
      box.addEventListener('click', (e) => {
        const a = closestOf<HTMLButtonElement>(e, '[data-rpm]');
        if (a && !a.disabled) {
          openReport(shiftM(reportM, parseInt(ds(a, 'rpm'), 10)));
          return;
        }
        const h = closestOf(e, '[data-rpmonth]');
        if (h) openReport(ds(h, 'rpmonth'));
      });
    }).catch((e: unknown) => {
      const box = document.getElementById('rp-body');
      if (box) box.innerHTML = '<p class="pw-err">' + esc(messageOf(e, 'The report could not load.')) + '</p>';
    });
  }

  function openPassword(): void {
    state.modal = 'pw';
    lockScroll();
    layer.innerHTML = '<div class="scrim" id="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
      '<div class="m-head"><div><h2 id="m-title">Change password</h2><div class="sm">Use at least 10 characters.</div></div><button class="x" id="m-x" aria-label="Close">×</button></div>' +
      '<div class="pw-body"><label class="k" for="pw-cur">Current password</label><input class="pwf" id="pw-cur" type="password" autocomplete="current-password">' +
      '<label class="k" for="pw-new">New password</label><input class="pwf" id="pw-new" type="password" autocomplete="new-password">' +
      '<label class="k" for="pw-again">Repeat new password</label><input class="pwf" id="pw-again" type="password" autocomplete="new-password"><p class="pw-err" id="pw-err" role="alert"></p></div>' +
      '<div class="m-foot"><button class="btn" id="m-cancel">Cancel</button><button class="btn assign" id="pw-go">Save password</button></div></div></div>';
    el('pw-cur').focus();
    el('m-x').onclick = el('m-cancel').onclick = closeModal;
    wireScrim();
    el('pw-go').onclick = () => {
      const cur = el<HTMLInputElement>('pw-cur').value;
      const nw = el<HTMLInputElement>('pw-new').value;
      const again = el<HTMLInputElement>('pw-again').value;
      const err = el('pw-err');
      const go = el<HTMLButtonElement>('pw-go');
      err.textContent = '';
      if (!cur) {
        err.textContent = 'Enter your current password.';
        return;
      }
      if (nw.length < 10) {
        err.textContent = 'Use at least 10 characters.';
        return;
      }
      if (nw !== again) {
        err.textContent = 'The two new passwords do not match.';
        return;
      }
      go.disabled = true;
      go.textContent = 'One moment';
      api<unknown>('POST', '/api/auth/change-password', { current: cur, next: nw }).then(() => {
        closeModal();
      }).catch((e: unknown) => {
        go.disabled = false;
        go.textContent = 'Save password';
        err.textContent = messageOf(e, 'Something went wrong. Please try again.');
      });
    };
  }
  function openSignAll(): void {
    state.modal = 'signall';
    lockScroll();
    layer.innerHTML = '<div class="scrim" id="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
      '<div class="m-head"><div><h2 id="m-title">Sign out of all devices?</h2><div class="sm">You will need to sign in again on every phone and computer, including this one.</div></div><button class="x" id="m-x" aria-label="Close">×</button></div>' +
      '<div class="m-foot"><button class="btn" id="m-cancel">Cancel</button><button class="btn assign" id="sa-go">Sign out everywhere</button></div></div></div>';
    el('m-x').onclick = el('m-cancel').onclick = closeModal;
    wireScrim();
    el('sa-go').onclick = () => {
      const toLogin = (): void => {
        window.location.href = '/login';
      };
      api<unknown>('POST', '/api/auth/logout-all').then(toLogin).catch(toLogin);
    };
  }

  /* ---------- KPIs ---------- */
  /* Targets are demo numbers; the admin panel will set the real ones. They only apply to the monthly view. */
  const TARGETS: Targets = { contacted: DATA.targets.contacted || 0, meetings: DATA.targets.meetings || 0, won: DATA.targets.won || 0 };
  function kindOf(stage: string): string {
    return stage === 'Won' ? 'green' : (stage === 'Lost' ? 'red' : 'black');
  }
  function periodStart(p: string): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (p === '7d') d.setDate(d.getDate() - 6);
    else if (p === 'month') d.setDate(1);
    return d.getTime();
  }
  function enteredIn(l: Lead, stage: string, start: number): boolean {
    return (claim(l).history || []).some((e) => e.s === stage && e.t >= start);
  }
  function leftNewIn(l: Lead, start: number): boolean {
    const h = claim(l).history || [];
    for (let i = 0; i < h.length; i++) {
      if (h[i].s !== 'New') return h[i].t >= start;
    }
    return false;
  }
  function monthElapsed(): number {
    const d = new Date();
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() / dim;
  }

  function assignedIn(l: Lead, start: number): boolean {
    const h = claim(l).history || [];
    return h.length > 0 && h[0].t >= start;
  }
  /* Three boxes: Assigned (just the number), then Contacted and Closed, each the number big with "of <monthly target>" small under it. */
  function statStrip(assigned: number, contacted: number, closed: number, showTarget: boolean, aria: string): string {
    function box(n: number, label: string, target: number): string {
      return '<div><b class="num">' + n + '</b><small class="pf-of">' + (showTarget && target ? 'of ' + target : '&nbsp;') + '</small><span>' + label + '</span></div>';
    }
    return '<div class="pf-stats" role="group" aria-label="' + esc(aria) + '">' + box(assigned, 'Assigned', 0) + box(contacted, 'Contacted', TARGETS.contacted) + box(closed, 'Closed', TARGETS.won) + '</div>';
  }

  function renderKpi(): void {
    const m = mine();
    const by: Record<string, number> = {};
    STAGES.concat(['Lost']).forEach((s) => {
      by[s] = 0;
    });
    m.forEach((l) => {
      by[claim(l).status]++;
    });
    const p = state.kpiPeriod;
    const start = periodStart(p);
    const month = (p === 'month');
    const contacted = m.filter((l) => leftNewIn(l, start)).length;
    const won = m.filter((l) => enteredIn(l, 'Won', start)).length;
    const openL = m.filter((l) => {
      const s = claim(l).status;
      return s !== 'Won' && s !== 'Lost';
    });
    const overdue = openL.filter((l) => groupOf(l) === 'od').length;
    const nodate = openL.filter((l) => groupOf(l) === 'none').length;
    const max = Math.max(...Object.keys(by).map((s) => by[s]), 1);
    const found: { lead: Lead; c: ClaimComment }[] = [];
    m.forEach((l) => {
      const mineC = claim(l).comments.filter((c) => c.by === state.user);
      if (mineC.length) found.push({ lead: l, c: mineC[mineC.length - 1] });
    });
    const acts = found.slice(0, 5);
    const seg = '<div class="kseg" role="group" aria-label="Period">' + KP_PERIODS.map((x) => '<button type="button" data-kp="' + x[0] + '"' + (p === x[0] ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '><span class="l-long">' + x[1] + '</span><span class="l-short">' + x[2] + '</span></button>').join('') + '</div>';
    let h = '<div class="head khead"><h1>KPIs</h1><span class="sub">' + esc(svcName()) + '<span class="l-long"> · ' + esc(self().name) + '</span></span>' + seg + '</div>';
    if (!m.length) {
      view.innerHTML = h + '<div class="tablewrap"><div class="empty"><b>No leads assigned yet</b>Your numbers appear here once you assign leads in Leads.</div></div>';
      return;
    }
    let att: string;
    if (overdue || nodate) {
      const bits: string[] = [];
      if (overdue) bits.push('<li><span class="num r">' + overdue + '</span>' + (overdue === 1 ? 'follow-up overdue' : 'follow-ups overdue') + '</li>');
      if (nodate) bits.push('<li><span class="num">' + nodate + '</span>' + (nodate === 1 ? 'lead has no follow-up date' : 'leads have no follow-up date') + '</li>');
      att = '<div class="katt ' + (overdue ? 'hot' : 'warn') + '"><div><div class="katt-t"><svg class="katt-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.2M12 16.3v.2"/></svg>Needs attention</div><ul class="katt-l">' + bits.join('') + '</ul></div><button type="button" class="btn assign" data-kgo="' + (overdue ? 'od' : 'later') + '">View in Assigned</button></div>';
    } else att = '<div class="katt calm"><span class="sm">Nothing overdue, and every open lead has a follow-up date.</span></div>';
    h += '<h3 class="kp-sh">' + (month ? 'Monthly target' : (p === 'today' ? 'Today' : 'Last 7 days')) + '</h3>' +
      statStrip(m.filter((l) => assignedIn(l, start)).length, contacted, won, month, month ? 'Monthly target' : 'Counts for the period') +
      (month ? '<p class="sm kpnote">This month · ' + Math.round(monthElapsed() * 100) + '% of the month gone</p>' : '<p class="sm kpnote">Counts for ' + (p === 'today' ? 'today' : 'the last 7 days') + ' · targets show on This month</p>') +
      att +
      '<div class="kcols"><section class="ksec"><h3>Pipeline now</h3>' +
        STAGES.concat(['Lost']).map((s) => {
          return '<div class="frow kc-' + kindOf(s) + '"><span class="st">' + SL(s) + '</span><span class="ftrack"><i style="width:' + Math.round(by[s] / max * 100) + '%"></i></span><span class="num">' + by[s] + '</span></div>';
        }).join('') + '</section>' +
      '<section class="ksec"><h3>Latest updates</h3>' + (acts.length ? acts.map((a) => {
        return '<div class="act"><div class="c-meta"><b>' + esc(a.lead.name) + '</b><span>' + esc(fmtAt(a.c.at)) + '</span><span class="st kc-' + kindOf(a.c.stage) + '">' + esc(SL(a.c.stage)) + '</span></div><p class="c-body">' + esc(a.c.text) + '</p></div>';
      }).join('') : '<p class="muted">No notes yet. Notes you add on assigned stores show up here.</p>') + '</section></div>';
    view.innerHTML = h;
  }

  /* ---------- wiring ---------- */
  function render(): void {
    chrome();
    const draw: Record<Tab, () => void> = { info: renderInfo, assigned: renderAssigned, kpi: renderKpi, profile: renderProfile };
    draw[state.tab]();
  }

  document.querySelectorAll<HTMLElement>('.tab').forEach((b) => {
    b.addEventListener('click', () => {
      const t = ds(b, 'tab');
      if (!isTab(t)) return;
      if (state.tab === t) {
        if (state.tab === 'assigned' && state.showDetail) {
          state.showDetail = false;
          settleBar();
          window.scrollTo(0, 0);
          renderAssigned();
          animateView('pop');
        }
        return;
      }
      state.tab = t;
      state.open = '';
      state.showDetail = false;
      settleBar();
      window.scrollTo(0, 0);
      render();
      animateView('tab');
    });
  });

  const gq = el<HTMLInputElement>('gq');
  const topBar = qs('.top');
  gq.addEventListener('focus', () => {
    topBar.classList.add('search-open');
  });
  gq.addEventListener('blur', () => {
    setTimeout(() => {
      if (!gq.value.trim() && document.activeElement !== gq) topBar.classList.remove('search-open');
    }, 120);
  });
  el('gclose').addEventListener('click', (e) => {
    e.preventDefault();
    gq.value = '';
    state.q = '';
    state.page = 0;
    gq.blur();
    topBar.classList.remove('search-open');
    render();
  });
  gq.addEventListener('input', () => {
    state.q = gq.value;
    state.page = 0;
    render();
  });


  document.addEventListener('click', () => {
    setTimeout(() => {
      if (state.open !== 'nt') renderNt();
    }, 0);
  });
  document.addEventListener('click', (e) => {
    const ne_ = closestOf(e, '[data-noteedit]');
    if (ne_) {
      startEdit(parseInt(ds(ne_, 'noteedit'), 10));
      return;
    }
    const ns_ = closestOf(e, '[data-notesave]');
    if (ns_) {
      const box = ns_.closest<HTMLElement>('.tl2-note');
      if (box) saveEdit(box);
      return;
    }
    if (closestOf(e, '[data-notecancel]')) {
      refreshActivity();
      return;
    }
    const ntb = closestOf(e, '[data-ntbtn]');
    if (ntb) {
      setOpen(state.open === 'nt' ? '' : 'nt');
      return;
    }
    const nta = closestOf(e, '[data-ntall]');
    if (nta) {
      markRead(notifications().map((n) => n.id));
      renderNt(true);
      return;
    }
    const nto = closestOf(e, '[data-ntopt]');
    if (nto) {
      openNotification(ds(nto, 'ntopt'));
      return;
    }
    const wsb = closestOf(e, '[data-wsbtn]');
    if (wsb) {
      setOpen(state.open === 'ws' ? '' : 'ws');
      return;
    }
    const wso = closestOf(e, '[data-wsopt]');
    if (wso) {
      switchService(ds(wso, 'wsopt'));
      return;
    }
    const wb = closestOf(e, '[data-whobtn]');
    if (wb) {
      setOpen(state.open === 'who' ? '' : 'who');
      return;
    }
    const th_ = closestOf(e, '[data-setheme]');
    if (th_) {
      setTheme(ds(th_, 'setheme'));
      return;
    }
    const so_ = closestOf(e, '[data-signout]');
    if (so_) {
      signOut();
      return;
    }
    if (state.open && !closestOf(e, '.combo')) setOpen('');
    const c = closestOf(e, '[data-copy]');
    if (c) {
      try {
        navigator.clipboard.writeText(ds(c, 'copy')).then(() => undefined, () => {
          toast('Copy not available here');
        });
      } catch {
        toast('Copy not available here');
      }
    }
  });

  view.addEventListener('click', (e) => {
    const nd = closestOf(e, '[data-need]');
    if (nd) {
      toggleNeed(ds(nd, 'need'));
      refineInfo();
      return;
    }
    const ob = closestOf(e, '[data-ddopt]');
    if (ob) {
      const id = ds(ob, 'ddopt');
      if (isDdId(id)) ddSet(id, ds(ob, 'v'));
      state.open = '';
      renderInfo();
      return;
    }
    const db = closestOf(e, '[data-ddbtn]');
    if (db) {
      setOpen(state.open === ds(db, 'ddbtn') ? '' : ds(db, 'ddbtn'));
      return;
    }
    const a = closestOf(e, '[data-assign]');
    if (a) {
      openModal(ds(a, 'assign'));
      return;
    }
    const gt = closestOf(e, '[data-goto]');
    if (gt) {
      state.page = parseInt(ds(gt, 'goto'), 10);
      renderInfo();
      window.scrollTo(0, 0);
      return;
    }
    const pg = closestOf(e, '[data-page]');
    if (pg) {
      state.page += parseInt(ds(pg, 'page'), 10);
      renderInfo();
      window.scrollTo(0, 0);
      return;
    }
    const bk = closestOf(e, '[data-back]');
    if (bk) {
      state.showDetail = false;
      settleBar();
      window.scrollTo(0, 0);
      renderAssigned();
      animateView('pop');
      return;
    }
    const p = closestOf(e, '[data-pick]');
    if (p) {
      state.selected = ds(p, 'pick');
      state.showDetail = true;
      settleBar();
      window.scrollTo(0, 0);
      renderAssigned();
      animateView('push');
      return;
    }
    const pf = closestOf(e, '[data-pf]');
    if (pf) {
      const k = ds(pf, 'pf');
      if (k === 'password') openPassword();
      else if (k === 'signall') openSignAll();
      else if (k === 'notes') openNotes();
      else if (k === 'report') openReport(null);
      else if (k === 'notifications') setOpen(state.open === 'nt' ? '' : 'nt');
      else if (k === 'today') {
        state.tab = 'assigned';
        state.qf = '';
        state.showDetail = false;
        state.open = '';
        settleBar();
        window.scrollTo(0, 0);
        render();
        animateView('tab');
      }
      return;
    }
    const inf = closestOf(e, '[data-info]');
    if (inf) {
      openInfo(ds(inf, 'info'));
      return;
    }
    const fl = closestOf(e, '[data-flow]');
    if (fl) {
      openFlow(state.selected);
      return;
    }
    const kp = closestOf(e, '[data-kp]');
    if (kp) {
      const period = ds(kp, 'kp');
      if (isKpiPeriod(period)) state.kpiPeriod = period;
      renderKpi();
      return;
    }
    const kg = closestOf(e, '[data-kgo]');
    if (kg) {
      state.tab = 'assigned';
      state.qf = '';
      state.showDetail = false;
      state.open = '';
      settleBar();
      window.scrollTo(0, 0);
      render();
      animateView('tab');
      return;
    }
    const sfb = closestOf(e, '[data-sfbtn]');
    if (sfb) {
      setOpen(state.open === 'sf' ? '' : 'sf');
      return;
    }
    const sfo = closestOf(e, '[data-sfopt]');
    if (sfo) {
      state.stageFilter = ds(sfo, 'sfopt');
      state.open = '';
      renderAssigned();
      return;
    }
    const qf = closestOf(e, '[data-qf]');
    if (qf) {
      state.qf = state.qf === ds(qf, 'qf') ? '' : ds(qf, 'qf');
      renderAssigned();
      return;
    }
    const ct = closestOf(e, '[data-closedtoggle]');
    if (ct) {
      state.closedOpen = !state.closedOpen;
      renderAssigned();
      return;
    }
    const sb = closestOf(e, '[data-stagebtn]');
    if (sb) {
      setOpen(state.open === 'stage' ? '' : 'stage');
      return;
    }
    const so = closestOf(e, '[data-stageopt]');
    if (so) {
      const l = byId(state.selected);
      const w = l && W(l);
      const ns = ds(so, 'stageopt');
      state.open = '';
      if (!l || !w || w.owner !== state.user || w.status === ns) {
        renderAssigned();
        return;
      }
      if (isPhone() && document.querySelector('.stp') && ns !== 'Lost' && w.status !== 'Lost') {
        if (movingStage) return;
        movingStage = true;
        const prev = w.status;
        liveStage(w, ns);
        api<Claim>('PATCH', '/api/sales/claims/' + w.id, { status: ns }).then((dto) => {
          l.work[state.service] = dto;
          state.logStage = ns;
          state.stgOpen = {};
          movingStage = false;
          if (ns === 'Won') {
            setTimeout(() => {
              renderAssigned();
              chrome();
            }, Math.max(1, STAGES.indexOf(ns) - STAGES.indexOf(prev)) * 300 + 700);
            return;
          }
          const ul = document.querySelector('.detail .d-sec .tl2');
          if (ul) ul.outerHTML = activityList(activityItems(dto).slice(0, 5));
          chrome();
        }).catch((err: unknown) => {
          movingStage = false;
          failToast(err);
          renderAssigned();
        });
        return;
      }
      saveClaim(l, { status: ns }, () => {
        state.logStage = ns;
        state.stgOpen = {};
        chrome();
      });
      return;
    }
    const fb = closestOf(e, '[data-fubtn]');
    if (fb) {
      const lo = byId(state.selected);
      const wo = lo && W(lo);
      state.calMonth = ((wo && wo.next) || dayOffset(0)).slice(0, 7);
      setOpen(state.open === 'fu' ? '' : 'fu');
      return;
    }
    const cn = closestOf(e, '[data-calnav]');
    if (cn) {
      const cy = parseInt(state.calMonth.slice(0, 4), 10);
      const cm = parseInt(state.calMonth.slice(5, 7), 10) - 1 + parseInt(ds(cn, 'calnav'), 10);
      const dd = new Date(cy, cm, 1);
      state.calMonth = dd.getFullYear() + '-' + pad2(dd.getMonth() + 1);
      renderAssigned();
      return;
    }
    const cd = closestOf(e, '[data-day]');
    if (cd) {
      const lc = byId(state.selected);
      const wc = lc && W(lc);
      state.open = '';
      if (!lc || !wc || wc.owner !== state.user) {
        renderAssigned();
        return;
      }
      saveClaim(lc, { next: ds(cd, 'day') });
      return;
    }
    const fq = closestOf(e, '[data-fu]');
    if (fq) {
      const lf = byId(state.selected);
      const wf = lf && W(lf);
      if (!lf || !wf || wf.owner !== state.user) return;
      const nextDay = ds(fq, 'fu') === 'clear' ? null : dayOffset(parseInt(ds(fq, 'fu'), 10));
      saveClaim(lf, { next: nextDay });
      return;
    }
    const tg = closestOf(e, '[data-stgtoggle]');
    if (tg) {
      const ls = byId(state.selected);
      const ws = ls && W(ls);
      const sn = ds(tg, 'stgtoggle');
      const cur = has(state.stgOpen, sn) ? state.stgOpen[sn] : !!(ws && sn === ws.status);
      state.stgOpen[sn] = !cur;
      renderAssigned();
      return;
    }
    const an = closestOf(e, '[data-addnote]');
    if (an) {
      state.logStage = ds(an, 'addnote');
      state.stgOpen[ds(an, 'addnote')] = true;
      renderAssigned();
      const nt = document.getElementById('note');
      if (nt) nt.focus();
      return;
    }
    if (e.target instanceof HTMLElement && e.target.id === 'post') {
      const ta = maybeEl('note', HTMLTextAreaElement);
      if (!ta) return;
      const txt = ta.value.trim();
      if (!txt) {
        ta.focus();
        toast('Write a note first, or skip it. Notes are optional.');
        return;
      }
      const cur = byId(state.selected);
      const cw = cur && W(cur);
      if (!cur || !cw || cw.owner !== state.user) return;
      api<Claim>('POST', '/api/sales/claims/' + cw.id + '/notes', { text: txt, stage: state.logStage || cw.status }).then((dto) => {
        cur.work[state.service] = dto;
        ta.value = '';
        renderAssigned();
      }).catch(failToast);
      return;
    }
  });
  /* phone tab bar: shrinks to icons after a real scroll down, expands on scroll up; ignores bounce and section changes so it never jumps */
  let lastY = 0;
  let acc = 0;
  let lastFlip = 0;
  const barEl = qs('.tabs');
  window.addEventListener('scroll', () => {
    const now = Date.now();
    const y = window.scrollY || 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (now < scrollLock || y < 0 || y > max) {
      lastY = Math.max(0, Math.min(y, max));
      acc = 0;
      return;
    }
    const d = y - lastY;
    lastY = y;
    if (d * acc < 0) acc = 0;
    acc += d;
    const isMin = barEl.classList.contains('min');
    /* never flip again while the last animation is still running, so the icons cannot jitter */
    if (!isMin && acc > 48 && y > 140 && now - lastFlip > 450) {
      barEl.classList.add('min');
      lastFlip = now;
      acc = 0;
    } else if (isMin && ((acc < -32 && now - lastFlip > 450) || y < 60)) {
      barEl.classList.remove('min');
      lastFlip = now;
      acc = 0;
    }
  }, { passive: true });

  /* Pull fresh data when the tab becomes visible and every couple of minutes. */
  let refreshing = false;
  function refresh(): void {
    if (refreshing || document.hidden || state.modal || assigning) return;
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) return;
    refreshing = true;
    api<Bootstrap>('GET', '/api/sales/bootstrap').then((d) => {
      refreshing = false;
      LEADS.length = 0;
      d.leads.forEach((r) => {
        LEADS.push(prepLead(r));
      });
      SERVICES.length = 0;
      d.workspaces.forEach((w) => {
        SERVICES.push(toService(w));
      });
      NOTICES.length = 0;
      d.notices.forEach((n) => {
        NOTICES.push(n);
      });
      d.reads.forEach((k) => {
        state.read[k] = true;
      });
      TARGETS.contacted = d.targets.contacted || 0;
      TARGETS.meetings = d.targets.meetings || 0;
      TARGETS.won = d.targets.won || 0;
      if (!SERVICES.some((s) => s.id === state.service) && SERVICES.length) state.service = SERVICES[0].id;
      if (state.selected && !byId(state.selected)) {
        state.selected = null;
        state.showDetail = false;
      }
      render();
    }).catch(() => {
      refreshing = false;
    });
  }
  document.addEventListener('visibilitychange', refresh);
  if (MQ_PHONE) {
    MQ_PHONE.addEventListener('change', () => {
      if (state.tab === 'assigned') render();
    });
  }
  setInterval(refresh, 120000);

  render();
  /* first placement without animation, then enable the glide */
  setTimeout(() => {
    placePill();
    qs('.tabs').classList.add('ready');
  }, 150);
}

import { api, messageOf } from './admin/api.js';
import type { Category, LeadsPage, ManagerBootstrap, ManagerView, TeamMember, Workspace } from './manager/types.js';
import { el } from './shared/dom.js';

const ICON: Record<'team' | 'leads', string> = {
  team: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.5-3.2 2.8-4.8 5.5-4.8s5 1.6 5.5 4.8"/><path d="M15.5 5.6a3.1 3.1 0 0 1 0 5.8M17.5 14.5c1.7.6 2.7 2 3 4.5"/></svg>',
  leads: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.6-3.6 3.5-5.5 7-5.5s6.4 1.9 7 5.5"/></svg>',
};
const ACCOUNT_ICON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.6-3.4 3.4-5.2 7-5.2s6.4 1.8 7 5.2"/></svg>';
const SEARCH = '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>';

type CategoryFilter = Category | 'all';

interface State {
  view: ManagerView;
  cat: CategoryFilter;
  q: string;
  page: number;
  leads: LeadsPage | null;
}

const S: State = { view: 'team', cat: 'all', q: '', page: 1, leads: null };
let D: ManagerBootstrap | null = null;

function data(): ManagerBootstrap {
  if (!D) throw new Error('The page data has not loaded yet.');
  return D;
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
function num(n: number): string {
  return '<span class="num">' + n.toLocaleString('en-IN') + '</span>';
}
function isCategory(v: string | undefined): v is Category {
  return v === 'scale' || v === 'reach';
}
/** The categories this manager can see, in a fixed order. */
function scope(): Category[] {
  const c = data().categories;
  return (['scale', 'reach'] as const).filter((k) => c[k] !== undefined);
}
function catName(c: Category): string {
  return data().categories[c]?.name ?? c;
}
function inCat(x: { category: Category | null }): boolean {
  return S.cat === 'all' || x.category === S.cat;
}
function ct(c: Category): string {
  return '<span class="ct"><i class="mk ' + c + '"></i>' + esc(catName(c)) + '</span>';
}
function toast(message: string): void {
  const t = el('toast');
  t.textContent = message;
  t.hidden = false;
  window.setTimeout(() => {
    t.hidden = true;
  }, 3200);
}
function fail(e: unknown): void {
  toast(messageOf(e));
}
function head(title: string, sub: string): string {
  return '<div class="head"><h1>' + title + '</h1><span class="sub">' + sub + '</span></div>';
}
function sub(): string {
  return S.cat === 'all' ? scope().map(catName).join(' and ') : catName(S.cat);
}

function nav(): void {
  const d = data();
  const count: Record<'team' | 'leads', number | null> = { team: d.people.filter(inCat).length, leads: null };
  const names: Record<'team' | 'leads', string> = { team: 'Team', leads: 'All leads' };
  el('bottom').innerHTML = (['team', 'leads', 'account'] as const)
    .map(
      (v) =>
        '<button type="button" data-view="' + v + '"' + (v === S.view ? ' aria-current="page"' : '') + '>' + (v === 'account' ? ACCOUNT_ICON : ICON[v]) + '<span>' + (v === 'account' ? 'Account' : names[v]) + '</span></button>',
    )
    .join('');
  document.querySelectorAll<HTMLElement>('.side .nv').forEach((b) => {
    const v = b.dataset['view'];
    if (v !== 'team' && v !== 'leads') return;
    const n = count[v];
    b.innerHTML = ICON[v] + '<span>' + names[v] + '</span>' + (n !== null ? '<span class="c">' + n + '</span>' : '');
    if (v === S.view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const cats = scope();
  const filters: CategoryFilter[] = cats.length > 1 ? ['all', ...cats] : [];
  const wrap = el('cats');
  wrap.style.gridTemplateColumns = 'repeat(' + filters.length + ',1fr)';
  wrap.hidden = filters.length === 0;
  wrap.innerHTML = filters
    .map((c) => '<button type="button" data-cat="' + c + '" aria-pressed="' + (S.cat === c) + '">' + (c === 'all' ? '' : '<i class="mk ' + c + '"></i>') + (c === 'all' ? 'All' : esc(catName(c))) + '</button>')
    .join('');
  el('catnote').textContent = cats.length > 1 ? (S.cat === 'all' ? 'Showing Scale and Reach together.' : catName(S.cat) + ' only.') : 'You see ' + catName(cats[0] ?? 'scale') + ' only.';
  const top = el('mcats');
  top.hidden = filters.length === 0 || S.view === 'account';
  top.style.gridTemplateColumns = 'repeat(' + filters.length + ',1fr)';
  top.innerHTML = wrap.innerHTML;
  el('mtitle').textContent = S.view === 'team' ? 'Team' : S.view === 'leads' ? 'All leads' : 'Account';
  el('view').setAttribute('data-tone', S.cat);
  el('me-av').textContent = d.me.ini;
  el('me-name').textContent = d.me.name;
}

function chips(p: TeamMember): string {
  const names = p.workspaceIds
    .map((id) => data().workspaces.find((w) => w.id === id))
    .filter((w): w is Workspace => w !== undefined)
    .map((w) => '<span class="chip">' + esc(w.name) + (S.cat === 'all' && scope().length > 1 ? ' <span class="muted">· ' + esc(catName(w.category)) + '</span>' : '') + '</span>');
  return names.length ? '<div class="chips">' + names.join('') + '</div>' : '<span class="muted">None yet</span>';
}

function vTeam(): string {
  const people = data().people.filter(inCat);
  let h = head('Team', 'Salespeople and their numbers this month, ' + sub());
  h +=
    '<div class="tw cards team"><table><thead><tr><th style="width:1%;white-space:nowrap">Sr. no</th><th>Name</th><th>Category</th><th>Services</th><th>Assigned</th><th>Contacted</th><th>Closed</th><th>Status</th></tr></thead><tbody>' +
    (people.length
      ? people
          .map((p, i) => {
            const state = !p.active ? 'Deactivated' : p.invited ? 'Invited' : 'Active';
            return (
              '<tr><td class="muted num" data-l="n">' + (i + 1) + '</td><td data-l="name"><span class="own static"><span class="av">' + esc(p.ini) + '</span><span>' + esc(p.name) + '</span></span></td><td data-l="cat">' +
              (p.category ? ct(p.category) : '') + '</td><td data-label="Services" data-l="svc">' + chips(p) + '</td><td data-label="Assigned">' + num(p.stats.assigned) + '</td><td data-label="Contacted">' + num(p.stats.contacted) + '</td><td data-label="Closed">' + num(p.stats.won) +
              '</td><td data-l="state"><span class="dotl' + (p.active && !p.invited ? '' : ' off') + '"><i></i>' + state + '</span></td></tr>'
            );
          })
          .join('')
      : '<tr><td colspan="8"><div class="empty"><b>No salespeople yet</b>They appear here once a superadmin invites them.</div></td></tr>') +
    '</tbody></table></div>';
  return h + '<p class="hint">Assigned is everything a person owns. Contacted and Closed count this month. This page is view only.</p>';
}

function serviceColumns(): { key: string; name: string }[] {
  const seen = new Set<string>();
  const cols: { key: string; name: string }[] = [];
  for (const w of data().workspaces.filter(inCat)) {
    if (!seen.has(w.key)) {
      seen.add(w.key);
      cols.push({ key: w.key, name: w.name });
    }
  }
  return cols;
}

function vLeads(): string {
  const cols = serviceColumns();
  const res = S.leads;
  const scale = S.cat === 'scale';
  const all = S.cat === 'all' && scope().length > 1;
  let h = head('All leads', 'Who owns each lead, per service');
  h += '<div class="sb"><label class="search">' + SEARCH + '<input id="lq" type="search" placeholder="Search leads" value="' + esc(S.q) + '" aria-label="Search leads"></label></div>';
  if (!res) return h + '<div class="tw"><div class="empty">Loading</div></div>';
  const first = scope()[0];
  const onlyScale = !all && !scale && first === 'scale';
  const asScale = scale || onlyScale;
  const leadHead = asScale ? '<th>Person</th><th>Company</th><th>Job Title</th>' : all ? '<th>Lead</th><th>Company / Area</th><th>Category</th>' : '<th>Store</th><th>Area</th>';
  const rows = res.leads
    .map((l, i) => {
      const lead = asScale
        ? '<td style="font-weight:500" data-l="name">' + esc(l.name) + '</td><td data-label="Company">' + esc(l.company || '—') + '</td><td class="muted" data-label="Job title">' + esc(l.jobTitle || '—') + '</td>'
        : all
          ? '<td style="font-weight:500" data-l="name">' + esc(l.name) + '</td><td class="muted" data-label="Company / area">' + esc(l.category === 'scale' ? l.company || l.area : l.area) + '</td><td data-label="Category">' + ct(l.category) + '</td>'
          : '<td style="font-weight:500" data-l="name">' + esc(l.name) + '</td><td class="muted" data-label="Area">' + esc(l.area) + '</td>';
      const owners = cols
        .map((c) => {
          const w = data().workspaces.find((x) => x.id === l.category + '-' + c.key);
          if (!w) return '<td class="muted none-cell" data-label="' + esc(c.name) + '" title="Not offered in ' + esc(catName(l.category)) + '">&ndash;</td>';
          const o = l.owners[c.key];
          return (
            '<td data-label="' + esc(c.name) + '"><span class="own static' + (o ? '' : ' none') + '">' +
            (o ? '<span class="av">' + esc(o.name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()) + '</span>' + esc(o.name.split(' ')[0] ?? '') : 'Unassigned') +
            '</span></td>'
          );
        })
        .join('');
      return '<tr><td class="muted num" data-l="n">' + ((res.page - 1) * res.pageSize + i + 1) + '</td>' + lead + owners + '</tr>';
    })
    .join('');
  h +=
    '<div class="tw cards"><table><thead><tr><th style="width:1%;white-space:nowrap">Sr. no</th>' + leadHead + cols.map((c) => '<th>' + esc(c.name) + '</th>').join('') + '</tr></thead><tbody>' +
    (rows || '<tr><td colspan="' + (5 + cols.length) + '"><div class="empty"><b>No leads match</b>Try a different search.</div></td></tr>') +
    '</tbody></table></div>';
  const pages = Math.max(1, Math.ceil(res.total / res.pageSize));
  h += '<div class="pager"><span>' + res.total.toLocaleString('en-IN') + ' leads</span><button class="btn sm" data-lpage="-1"' + (res.page <= 1 ? ' disabled' : '') + '>Previous</button><span class="num">' + res.page + ' / ' + pages + '</span><button class="btn sm" data-lpage="1"' + (res.page >= pages ? ' disabled' : '') + '>Next</button></div>';
  return h + '<p class="hint">A dash means the category does not offer that service. This page is view only.</p>';
}

function vAccount(): string {
  const d = data();
  const seeing = scope().map(catName).join(' and ');
  return (
    head('Account', 'Manager') +
    '<div class="acct"><span class="av">' + esc(d.me.ini) + '</span><div><b>' + esc(d.me.name) + '</b><small>' + esc(d.me.email) + '</small></div></div>' +
    '<p class="hint">You can look at the team and every lead in ' + esc(seeing) + '. This page is view only, so nothing you do here changes anything.</p>' +
    '<button type="button" class="btn dark acct-out" data-signout>Sign out</button>'
  );
}

function render(keepFocus?: boolean): void {
  nav();
  const view = el('view');
  const focused = keepFocus && document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
  const caret = focused ? focused.selectionStart : null;
  view.innerHTML = S.view === 'account' ? vAccount() : (S.view === 'team' ? vTeam() : vLeads());
  if (focused) {
    const input = document.getElementById('lq');
    if (input instanceof HTMLInputElement) {
      input.focus();
      if (caret !== null) input.setSelectionRange(caret, caret);
    }
  }
}

function loadLeads(keepFocus?: boolean): void {
  const q = S.q;
  const page = S.page;
  const category = S.cat === 'all' ? '' : 'category=' + S.cat + '&';
  api<LeadsPage>('GET', '/api/manager/leads?' + category + 'q=' + encodeURIComponent(q) + '&page=' + page)
    .then((res) => {
      if (q !== S.q || page !== S.page) return;
      S.leads = res;
      if (S.view === 'leads') render(keepFocus);
    })
    .catch(fail);
}

let searchTimer: number | undefined;

document.addEventListener('input', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || t.id !== 'lq') return;
  S.q = t.value.trim();
  S.page = 1;
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => loadLeads(true), 250);
});

document.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const hit = (selector: string): HTMLElement | null => t.closest<HTMLElement>(selector);
  let c: HTMLElement | null;
  if (hit('[data-signout]')) {
    const back = (): void => {
      window.location.href = '/login';
    };
    api<unknown>('POST', '/api/auth/logout').then(back).catch(back);
    return;
  }
  if ((c = hit('[data-view]'))) {
    const v = c.dataset['view'];
    if (v !== 'team' && v !== 'leads' && v !== 'account') return;
    S.view = v;
    if (v === 'leads' && !S.leads) loadLeads();
    render();
    return;
  }
  if ((c = hit('[data-cat]'))) {
    const next = c.dataset['cat'];
    if (next !== 'all' && !isCategory(next)) return;
    S.cat = next;
    S.page = 1;
    S.leads = null;
    render();
    if (S.view === 'leads') loadLeads();
    return;
  }
  if ((c = hit('[data-lpage]'))) {
    const step = Number(c.dataset['lpage']);
    S.page = Math.max(1, S.page + (step < 0 ? -1 : 1));
    loadLeads();
  }
});

api<ManagerBootstrap>('GET', '/api/manager/bootstrap')
  .then((d) => {
    D = d;
    render();
  })
  .catch((e: unknown) => {
    el('view').innerHTML = '<div class="empty"><b>Could not load</b>' + esc(messageOf(e)) + '</div>';
  });

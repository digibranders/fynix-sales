import { api, messageOf } from './admin/api.js';
import type {
  Bootstrap,
  Category,
  CategoryFilter,
  DrawerForm,
  FormCat,
  InviteResult,
  LeadList,
  LeadsPage,
  LinkInfo,
  ListCreateBody,
  ListImportResult,
  Metric,
  ModalForm,
  ModalKind,
  PageState,
  Person,
  PickItem,
  Role,
  TargetsBody,
  UserCreateBody,
  UserCreateResult,
  View,
  Workspace,
  WorkspaceCreateBody,
} from './admin/types.js';
import { takeEmbedded } from './shared/boot.js';
import { el } from './shared/dom.js';
import { initPwa } from './shared/pwa.js';

initPwa();

const NAVICON: Record<string, string> = {

  overview:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="8" rx="1.5"/><rect x="13" y="4" width="7" height="5" rx="1.5"/><rect x="13" y="12" width="7" height="8" rx="1.5"/><rect x="4" y="15" width="7" height="5" rx="1.5"/></svg>',
  workspaces:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><path d="M16.8 13.5v6.5M13.5 16.8H20"/></svg>',
  lists:'<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.8" cy="6" r="1"/><circle cx="4.8" cy="12" r="1"/><circle cx="4.8" cy="18" r="1"/></svg>',
  leads:'<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.6-3.6 3.5-5.5 7-5.5s6.4 1.9 7 5.5"/></svg>',
  reports:'<svg viewBox="0 0 24 24"><path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8.5h5M9.5 17v-3M12.5 17v-5.5M15.5 17v-2"/></svg>',
  team:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.5-3.2 2.8-4.8 5.5-4.8s5 1.6 5.5 4.8"/><path d="M15.5 5.6a3.1 3.1 0 0 1 0 5.8M17.5 14.5c1.7.6 2.7 2 3 4.5"/></svg>'
};
const CATS: readonly Category[] = ['scale', 'reach'];
const PLUS = '<svg viewBox="0 0 14 14"><path d="M7 2v10M2 7h10"/></svg>';
const STAGE_LIST: readonly string[] = ['New', "Didn't Pick", 'Follow Up', 'Meeting', 'Won', 'Lost', 'Invalid Number', 'Invalid Email'];
const MONTHS: readonly string[] = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let D: Bootstrap | null = null; /* bootstrap data from the server */
const NOW = new Date();
const S: PageState = {
  report: { y: NOW.getFullYear(), m: NOW.getMonth() },
  view: 'overview',
  cat: 'all',
  modal: null,
  form: { m: null, drawer: null },
  leads: { q: '', page: 1, res: null, loading: false },
  drawerId: null,
  listConfirm: null,
  userConfirm: null,
};

/** The bootstrap data. Nothing is drawn before it has loaded, so a missing value is a bug. */
function data(): Bootstrap {
  if (!D) throw new Error('The page data has not loaded yet.');
  return D;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

let toastTimer: number | undefined;
function toast(m: string): void {
  const e = el('toast');
  e.textContent = m;
  e.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    e.hidden = true;
  }, 3200);
}
function fail(e: unknown): void {
  toast(messageOf(e));
}

/* ---------- narrowing ---------- */
function isCategory(v: string | undefined): v is Category {
  return v === 'scale' || v === 'reach';
}
function isCategoryFilter(v: string | undefined): v is CategoryFilter {
  return v === 'all' || isCategory(v);
}
const ROLE_NAME: Record<Role, string> = { sales: 'Sales', manager: 'Manager', superadmin: 'Superadmin' };
function isFormCat(v: string | undefined): v is FormCat {
  return v === 'both' || isCategory(v);
}
function isRole(v: string | undefined): v is Role {
  return v === 'sales' || v === 'manager' || v === 'superadmin';
}
function isView(v: string | undefined): v is View {
  return v !== undefined && Object.prototype.hasOwnProperty.call(VIEWS, v);
}

/* ---------- lookups ---------- */
function ws(id: string): Workspace | undefined {
  return data().workspaces.find((w) => w.id === id);
}
function person(id: string): Person | undefined {
  return data().people.find((p) => p.id === id);
}
function list(id: string): LeadList | undefined {
  return data().lists.find((l) => l.id === id);
}
function catName(c: Category): string {
  return data().categories[c].name;
}
function inCat(x: { category: Category | null }): boolean {
  return S.cat === 'all' || x.category === S.cat;
}
function pInCat(p: Person): boolean {
  return S.cat === 'all' || p.role === 'superadmin' || (p.role === 'manager' && p.category === null) || p.category === S.cat;
}
function ct(c: Category | null): string {
  return c ? '<span class="ct"><i class="mk ' + c + '"></i>' + esc(catName(c)) + '</span>' : '<span class="ct muted">Both</span>';
}
function chip(w: Workspace): string {
  return '<span class="chip">' + esc(w.name) + (S.cat === 'all' ? ' <span class="muted">· ' + esc(catName(w.category)) + '</span>' : '') + '</span>';
}
function av(p: Person): string {
  return '<span class="av">' + esc(p.ini) + '</span>';
}
function num(n: number): string {
  return '<span class="num">' + Number(n).toLocaleString('en-IN') + '</span>';
}
function when(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const day = 864e5;
  const diff = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / day);
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (diff <= 0) return 'Today, ' + t;
  if (diff === 1) return 'Yesterday, ' + t;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function wsOf(p: Person): string {
  if (p.role === 'manager') return '<span class="muted">Team and leads, view only</span>';
  return p.role === 'superadmin'
    ? '<span class="muted">Every workspace</span>'
    : p.workspaceIds.length
      ? '<div class="chips">' +
        p.workspaceIds
          .map((i) => {
            const w = ws(i);
            return w ? chip(w) : '';
          })
          .join('') +
        '</div>'
      : '<span class="muted">None yet</span>';
}

/* ---------- chrome ---------- */
function nav(): void {
  const d = data();
  const names: Record<string, string> = { overview: 'Overview', workspaces: 'Services', lists: 'Lists', leads: 'All leads', team: 'Team', reports: 'Reports' };
  const cnt: Record<string, number | undefined> = {
    workspaces: d.workspaces.filter(inCat).length,
    lists: d.lists.filter(inCat).length,
    team: d.people.filter(pInCat).length,
  };
  document.querySelectorAll<HTMLElement>('.nv').forEach((b) => {
    const v = b.dataset['view'] ?? '';
    const count = cnt[v];
    b.innerHTML = NAVICON[v] + '<span>' + names[v] + '</span>' + (count != null ? '<span class="c">' + count + '</span>' : '');
    if (v === S.view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const filters: CategoryFilter[] = ['all', 'scale', 'reach'];
  el('cats').innerHTML = filters
    .map((c) => '<button type="button" data-cat="' + c + '" aria-pressed="' + (S.cat === c) + '">' + (c === 'all' ? '' : '<i class="mk ' + c + '"></i>') + (c === 'all' ? 'All' : esc(catName(c))) + '</button>')
    .join('');
  el('catnote').textContent = S.cat === 'all' ? 'Showing Scale and Reach together.' : catName(S.cat) + ': ' + d.categories[S.cat].sub.toLowerCase() + '. Its own lists, leads and people.';
  el('view').setAttribute('data-tone', S.cat);
  el('me-av').textContent = d.me.ini;
  el('me-name').textContent = d.me.name;
}
function sub(): string {
  return S.cat === 'all' ? 'Scale and Reach' : catName(S.cat) + ', ' + data().categories[S.cat].sub.toLowerCase();
}
function head(t: string, s: string, actions?: string): string {
  return '<div class="head"><h1>' + t + '</h1><span class="sub">' + s + '</span><div class="r">' + (actions || '') + '</div></div>';
}

/* ---------- views ---------- */
function vOverview(): string {
  const d = data();
  const W = d.workspaces.filter(inCat);
  const L = d.lists.filter(inCat);
  const P = d.people.filter((p) => p.role === 'sales' && pInCat(p));
  let total = 0;
  let claimed = 0;
  W.forEach((w) => {
    total += w.leadCount;
    claimed += w.claimedCount;
  });
  const leadsImported = L.reduce((a, l) => a + l.leadCount, 0);
  let h = head('Overview', sub());
  h +=
    '<div class="stats"><div class="stat"><b>' + leadsImported.toLocaleString('en-IN') + '</b><span>Leads imported</span></div>' +
    '<div class="stat"><b>' + claimed.toLocaleString('en-IN') + '</b><span>Claims across services</span></div>' +
    '<div class="stat"><b>' + (total ? Math.round((claimed / total) * 100) : 0) + '%</b><span>Claimed</span></div>' +
    '<div class="stat"><b>' + P.filter((p) => p.active && !p.invited).length + '</b><span>Active salespeople</span></div></div>';
  h +=
    '<div class="two"><div class="blk"><h2>Services</h2>' +
    (W.length
      ? W.map((w, i) => {
          const pct = w.leadCount ? Math.round((w.claimedCount / w.leadCount) * 100) : 0;
          return '<div class="wsrow"><span class="wsn"><span class="muted num" style="margin-right:8px">' + (i + 1) + '</span>' + esc(w.name) + (S.cat === 'all' ? ' ' + ct(w.category) : '') + '</span><span class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span><span class="muted num">' + w.claimedCount + ' / ' + w.leadCount + '</span><span class="num" style="text-align:right">' + pct + '%</span></div>';
        }).join('')
      : '<div class="muted">No workspaces yet.</div>') +
    '</div>' +
    '<div class="blk"><h2>Recent activity</h2>' +
    (() => {
      const a = d.activity.filter((x) => S.cat === 'all' || !x.category || x.category === S.cat).slice(0, 8);
      return a.length ? '<ul class="act">' + a.map((x) => '<li><span>' + esc(x.text) + '</span><small>' + (x.sub ? esc(x.sub) + ' · ' : '') + when(x.at) + '</small></li>').join('') + '</ul>' : '<div class="muted">Nothing yet.</div>';
    })() +
    '</div></div>';
  h +=
    '<div class="blk"><h2>Salespeople this month</h2>' +
    (P.length
      ? '<div class="tw"><table><thead><tr><th style="width:1%;white-space:nowrap">Sr. no</th><th>Name</th>' + (S.cat === 'all' ? '<th>Category</th>' : '') + '<th>Services</th><th>Assigned</th><th>Contacted</th><th>Won</th></tr></thead><tbody>' +
        P.map((p, i) => '<tr><td class="muted num">' + (i + 1) + '</td><td><span class="own static">' + av(p) + esc(p.name) + '</span></td>' + (S.cat === 'all' ? '<td>' + ct(p.category) + '</td>' : '') + '<td>' + wsOf(p) + '</td><td>' + num(p.stats.assigned) + '</td><td>' + num(p.stats.contacted) + '</td><td>' + num(p.stats.won) + '</td></tr>').join('') +
        '</tbody></table></div>'
      : '<div class="muted">No salespeople yet.</div>') +
    '</div>';
  const cats: readonly Category[] = S.cat === 'all' ? CATS : [S.cat];
  const targetLabels: Record<'contacted' | 'won', string> = { contacted: 'Contacted target', won: 'Won target' };
  const targetMetrics: readonly ('contacted' | 'won')[] = ['contacted', 'won'];
  h +=
    '<div class="blk"><h2>Monthly targets</h2>' +
    cats
      .map((c) => {
        const t = d.targets[c] ?? { contacted: 0, meetings: 0, won: 0 };
        return (
          '<div class="tgt" data-targets="' + c + '"><h3>' + esc(catName(c)) + '</h3>' +
          targetMetrics
            .map((m) => '<div><label for="t-' + c + '-' + m + '">' + targetLabels[m] + '</label><input class="inp sm num" id="t-' + c + '-' + m + '" type="number" min="0" max="10000" value="' + t[m] + '"></div>')
            .join('') +
          '<button class="btn" data-save-targets="' + c + '">Save</button></div>'
        );
      })
      .join('') +
    '<p class="hint">Shown to each salesperson as "of N" under Contacted and Won in KPIs and Profile. Assigned has no target.</p></div>';
  return h;
}

function vWorkspaces(): string {
  const W = data().workspaces.filter(inCat);
  let h = head('Services', 'What your team sells', '<button class="btn dark" data-new="ws">' + PLUS + 'Add service</button>');
  h += W.length
    ? '<div class="tw"><table><thead><tr><th style="width:1%;white-space:nowrap">Sr. no</th><th>Service</th>' + (S.cat === 'all' ? '<th>Category</th>' : '') + '<th>Lists</th><th>Salespeople</th><th>Leads</th><th>Claimed</th></tr></thead><tbody>' +
      W.map((w, i) => {
        const m = w.memberIds.length;
        return '<tr class="click" data-ws="' + esc(w.id) + '"><td class="muted num">' + (i + 1) + '</td><td><span class="wsn">' + esc(w.name) + '</span></td>' + (S.cat === 'all' ? '<td>' + ct(w.category) + '</td>' : '') + '<td class="muted">' +
          (w.listIds
            .map((i2) => {
              const l = list(i2);
              return l ? esc(l.name) : '';
            })
            .join(', ') || 'None') +
          '</td><td>' + num(m) + '</td><td>' + num(w.leadCount) + '</td><td>' + num(w.claimedCount) + '</td></tr>';
      }).join('') +
      '</tbody></table></div>'
    : '<div class="tw"><div class="empty"><b>No workspaces yet</b>Add one to start assigning leads.</div></div>';
  return h + '<p class="hint">Each service belongs to one category and only uses that category\'s lists and people. Select a row to manage it.</p>';
}

function vLists(): string {
  const d = data();
  const L = d.lists.filter(inCat);
  let h = head('Lists', 'Imported lead files', '<button class="btn dark" data-new="list">' + PLUS + 'Import list</button>');
  h += L.length
    ? '<div class="tw"><table><thead><tr><th style="width:1%;white-space:nowrap">Sr. no</th><th>List</th>' + (S.cat === 'all' ? '<th>Category</th>' : '') + '<th>File</th><th>Leads</th><th>Used in</th><th>Imported</th><th></th></tr></thead><tbody>' +
      L.map((l, i) => {
        const used = d.workspaces.filter((w) => w.listIds.indexOf(l.id) > -1);
        const ask = S.listConfirm === l.id;
        const acts = ask
          ? '<span class="muted">Remove this list?</span><button class="btn sm" data-lcancel>Keep</button> <button class="btn sm danger" data-ldel="' + esc(l.id) + '">Remove</button>'
          : iconBtn('data-ltoggle', l.id, l.archived ? 'Activate' : 'Deactivate', l.archived ? ACT_ICON.play : ACT_ICON.pause) + iconBtn('data-lask', l.id, 'Remove', ACT_ICON.trash, true);
        return '<tr' + (l.archived ? ' style="opacity:.62"' : '') + '><td class="muted num">' + (i + 1) + '</td><td style="font-weight:500">' + esc(l.name) +
          (l.archived ? ' <span class="muted" style="font-weight:400;font-size:12px;border:1px solid var(--line2);border-radius:6px;padding:1px 6px;margin-left:6px">Inactive</span>' : '') +
          '</td>' + (S.cat === 'all' ? '<td>' + ct(l.category) + '</td>' : '') + '<td class="muted num">' + esc(l.fileName) + '</td><td>' + num(l.leadCount) + '</td><td><div class="chips">' +
          (used.length ? used.map(chip).join('') : '<span class="muted">Not in any workspace</span>') +
          '</div></td><td class="muted">' + when(l.createdAt) + '</td><td><div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;align-items:center;min-width:92px">' + acts + '</div></td></tr>';
      }).join('') +
      '</tbody></table></div>'
    : '<div class="tw"><div class="empty"><b>No lists yet</b>Import a CSV to add leads.</div></div>';
  return h + '<p class="hint">A list belongs to one category. It can only be added to that category\'s services. Deactivate stops new claims and keeps all work done; Remove deletes the list for good.</p>';
}

function serviceColumns(): { key: string; name: string }[] {
  const seen: Record<string, number | undefined> = {};
  const cols: { key: string; name: string }[] = [];
  data()
    .workspaces.filter(inCat)
    .forEach((w) => {
      if (!seen[w.key]) {
        seen[w.key] = 1;
        cols.push({ key: w.key, name: w.name });
      }
    });
  return cols;
}
function vLeads(): string {
  const cols = serviceColumns();
  const st = S.leads;
  const res = st.res;
  const isScale = S.cat === 'scale';
  let h = head('All leads', 'Who owns each lead, per service');
  h += '<div class="sb"><label class="search"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg><input id="lq" type="search" placeholder="Search leads" value="' + esc(st.q) + '" aria-label="Search leads"></label></div>';
  if (!res) return h + '<div class="tw"><div class="empty">Loading</div></div>';
  const leadHead = isScale ? '<th>Person</th><th>Company</th><th>Job Title</th>' : S.cat === 'all' ? '<th>Lead</th><th>Company / Area</th><th>Category</th>' : '<th>Store</th><th>Area</th>';
  h +=
    '<div class="tw"><table><thead><tr><th style="width:1%;white-space:nowrap">Sr. no</th>' + leadHead + cols.map((c) => '<th>' + esc(c.name) + '</th>').join('') + '</tr></thead><tbody>' +
    (res.leads.length
      ? res.leads
          .map((l, i) => {
            const leadCols = isScale
              ? '<td style="font-weight:500">' + esc(l.name) + '</td><td>' + esc(l.company || '—') + '</td><td class="muted">' + esc(l.jobTitle || '—') + '</td>'
              : S.cat === 'all'
                ? '<td style="font-weight:500">' + esc(l.name) + '</td><td class="muted">' + esc(l.category === 'scale' ? l.company || l.area : l.area) + '</td><td>' + ct(l.category) + '</td>'
                : '<td style="font-weight:500">' + esc(l.name) + '</td><td class="muted">' + esc(l.area) + '</td>';
            return (
              '<tr><td class="muted num">' + ((res.page - 1) * res.pageSize + i + 1) + '</td>' + leadCols +
              cols
                .map((c) => {
                  const w = ws(l.category + '-' + c.key);
                  if (!w) return '<td class="muted" title="Not offered in ' + esc(catName(l.category)) + '">&ndash;</td>';
                  const o = l.owners[c.key];
                  return (
                    '<td><button class="own' + (o ? '' : ' none') + '" data-own="' + esc(l.id) + '|' + esc(w.id) + '" aria-label="Change owner for ' + esc(l.name) + ' in ' + esc(w.name) + '">' +
                    (o
                      ? '<span class="av">' + esc(o.name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()) + '</span>' + esc(o.name.split(' ')[0])
                      : 'Unassigned') +
                    '</button></td>'
                  );
                })
                .join('') +
              '</tr>'
            );
          })
          .join('')
      : '<tr><td colspan="' + (5 + cols.length) + '"><div class="empty"><b>No leads match</b>Try a different search.</div></td></tr>') +
    '</tbody></table></div>';
  const pages = Math.max(1, Math.ceil(res.total / res.pageSize));
  h += '<div class="pager"><span>' + res.total.toLocaleString('en-IN') + ' leads</span><button class="btn sm" data-lpage="-1"' + (res.page <= 1 ? ' disabled' : '') + '>Previous</button><span class="num">' + res.page + ' / ' + pages + '</span><button class="btn sm" data-lpage="1"' + (res.page >= pages ? ' disabled' : '') + '>Next</button></div>';
  return h + '<p class="hint">Click an owner to reassign or release that lead. A dash means the category does not offer that service. Salespeople never see these names.</p>';
}
function loadLeads(keepFocus?: boolean): void {
  const st = S.leads;
  const q = st.q;
  const page = st.page;
  api<LeadsPage>('GET', '/api/admin/leads?' + (S.cat === 'all' ? '' : 'category=' + S.cat + '&') + 'q=' + encodeURIComponent(q) + '&page=' + page)
    .then((res) => {
      if (q !== S.leads.q || page !== S.leads.page) return;
      S.leads.res = res;
      if (S.view === 'leads') render(keepFocus);
    })
    .catch(fail);
}

const ACT_ICON = {
  swap: '<path d="M6 8h12l-3-3M18 16H6l3 3"/>',
  pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 7.5l3 3"/>',
  services: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5L19 4M16 7l2.5 2.5M13.5 9.5L15 11"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  pause: '<circle cx="12" cy="12" r="8.5"/><path d="M10 9v6M14 9v6"/>',
  play: '<circle cx="12" cy="12" r="8.5"/><path d="M10.5 9l4.5 3-4.5 3z"/>',
  trash: '<path d="M5 7h14M9 7V5h6v2M7 7l.8 12h8.4L17 7M10 11v5M14 11v5"/>',
};
/** A boxless icon button; the label shows on hover and is read out by screen readers. */
function iconBtn(attr: string, id: string, label: string, paths: string, danger?: boolean): string {
  return '<button type="button" class="ib' + (danger ? ' danger' : '') + '" ' + attr + '="' + esc(id) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg></button>';
}

function vTeam(): string {
  const d = data();
  const P = d.people.filter(pInCat);
  let h = head('Team', 'Everyone who can sign in', '<button class="btn dark" data-new="person">' + PLUS + 'Invite member</button>');
  h +=
    '<div class="tw"><table><thead><tr><th style="width:1%;white-space:nowrap">Sr. no</th><th>Name</th><th>Role</th><th>Category</th><th>Services</th><th>Status</th><th></th></tr></thead><tbody>' +
    P.map((p, i) => {
      const self = p.id === d.me.id;
      return (
        '<tr><td class="muted num">' + (i + 1) + '</td><td><span class="own static">' + av(p) + '<span>' + esc(p.name) + '<br><small class="muted">' + esc(p.email) + '</small></span></span></td><td class="role">' + ROLE_NAME[p.role] + '</td><td>' + (p.role === 'superadmin' ? ct(null) : ct(p.category)) + '</td><td>' + wsOf(p) + '</td>' +
        '<td><span class="dotl' + (p.active && !p.invited ? '' : ' off') + '"><i></i>' + (!p.active ? 'Deactivated' : p.invited ? 'Invited' : 'Active') + '</span></td>' +
        '<td style="text-align:right;white-space:nowrap"><span class="acts">' +
        (S.userConfirm === p.id
          ? '<span class="muted">Delete ' + esc(p.name) + ' for good?</span> <button class="btn sm" data-ucancel>Keep</button> <button class="btn sm danger" data-udel="' + esc(p.id) + '">Delete</button>'
          : iconBtn('data-rename', p.id, 'Edit name', ACT_ICON.pencil) +
            (p.role === 'superadmin' ? '' : iconBtn('data-chcat', p.id, 'Change category', ACT_ICON.swap)) +
            (p.role === 'sales' ? iconBtn('data-editpeople', p.id, 'Services', ACT_ICON.services) : '') +
            (self
              ? ''
              : iconBtn('data-reset', p.id, p.invited ? 'Invite link' : 'Reset password', p.invited ? ACT_ICON.link : ACT_ICON.key) +
                iconBtn('data-toggle', p.id, p.active ? 'Deactivate' : 'Reactivate', p.active ? ACT_ICON.pause : ACT_ICON.play) +
                iconBtn('data-uask', p.id, 'Delete', ACT_ICON.trash, true))) +
        '</span>' +
        '</td></tr>'
      );
    }).join('') +
    '</tbody></table></div>';
  return h + '<p class="hint">A salesperson belongs to one category and can only see that category\'s data. Managers can look at the team and leads in their category (or both) but cannot change anything. Superadmins see both. Delete removes a person for good, and is blocked while they still own leads.</p>';
}

function reportMonth(): string {
  return S.report.y + '-' + String(S.report.m + 1).padStart(2, '0');
}
function isCurrentMonth(): boolean {
  return S.report.y === NOW.getFullYear() && S.report.m === NOW.getMonth();
}
function vReports(): string {
  let h = head('Reports', 'Monthly report');
  const href = '/api/admin/reports/monthly?month=' + reportMonth() + (S.cat === 'all' ? '' : '&category=' + S.cat);
  h +=
    '<div class="rep"><div class="rep-month" role="group" aria-label="Month"><button type="button" class="rep-arrow" data-rmonth="-1" aria-label="Previous month"><svg viewBox="0 0 8 14" aria-hidden="true"><path d="M7 1L1 7l6 6"/></svg></button>' +
    '<b class="rep-label">' + MONTHS[S.report.m] + ' ' + S.report.y + '</b>' +
    '<button type="button" class="rep-arrow" data-rmonth="1" aria-label="Next month"' + (isCurrentMonth() ? ' disabled' : '') + '><svg viewBox="0 0 8 14" aria-hidden="true"><path d="M1 1l6 6-6 6"/></svg></button></div>' +
    '<p class="muted rep-scope">' + (S.cat === 'all' ? 'Scale and Reach' : esc(catName(S.cat))) + '. Change this with the category switch on the left.</p>' +
    '<a class="btn dark rep-dl" href="' + href + '" download>Download CSV</a></div>';
  h +=
    '<div class="blk"><h2>What is in the file</h2><ul class="act">' +
    '<li><span>One row for every salesperson in every service, including people who did nothing that month.</span></li>' +
    '<li><span>Assigned: leads claimed in the month. Contacted: leads that first moved out of New in the month.</span></li>' +
    '<li><span>Didn\'t Pick, Follow Up, Meetings, Won, Lost and Invalid: leads that reached that stage in the month.</span></li>' +
    '<li><span>Open now: leads the person still owns that are not Won, Lost or Invalid.</span></li>' +
    '<li><span>A Total row after each service and a final row for everything.</span></li></ul></div>';
  return h;
}
const VIEWS: Record<View, () => string> = { overview: vOverview, workspaces: vWorkspaces, lists: vLists, leads: vLeads, team: vTeam, reports: vReports };
function render(keepFocus?: boolean): void {
  nav();
  el('view').innerHTML = VIEWS[S.view]();
  if (keepFocus && S.view === 'leads') {
    const i = document.getElementById('lq');
    if (i instanceof HTMLInputElement) {
      i.focus();
      i.setSelectionRange(i.value.length, i.value.length);
    }
  }
}
function reload(then?: () => void): Promise<void> {
  return api<Bootstrap>('GET', '/api/admin/bootstrap')
    .then((d) => {
      D = d;
      if (then) then();
      render();
      if (S.drawerId && !el('drawer').hidden) openDrawer(S.drawerId);
    })
    .catch(fail);
}
function goto(view: View): void {
  S.view = view;
  S.userConfirm = null;
  closeAll();
  if (view === 'leads') {
    S.leads.res = null;
    S.leads.page = 1;
    render();
    loadLeads();
  } else render();
  window.scrollTo(0, 0);
}

/* ---------- drawer: one service ---------- */
function pickRows(items: PickItem[], sel: string[], key: string): string {
  const allOn = items.length > 0 && items.every((it) => sel.indexOf(it.id) > -1);
  const all = items.length > 1 && /^(wss|lists|members)$/.test(key) ? '<button type="button" class="pk" data-pk="' + key + '|*" aria-pressed="' + allOn + '"><span class="cb"></span><span><b>Select all</b></span></button>' : '';
  return items.length
    ? '<div class="pick">' + all + items.map((it) => '<button type="button" class="pk" data-pk="' + key + '|' + esc(it.id) + '" aria-pressed="' + (sel.indexOf(it.id) > -1) + '"><span class="cb"></span><span>' + esc(it.name) + '</span></button>').join('') + '</div>'
    : '<p class="hint">Nothing in this category yet.</p>';
}
function openDrawer(id: string): void {
  const d = data();
  const w = ws(id);
  if (!w) {
    closeAll();
    return;
  }
  S.drawerId = id;
  let F = S.form.drawer;
  if (!F || F.id !== id) {
    F = { id, lists: w.listIds.slice(), members: w.memberIds.slice(), confirm: false, error: '' };
    S.form.drawer = F;
  }
  el('drawer').innerHTML =
    '<div class="dh"><h3>' + esc(w.name) + ' ' + ct(w.category) + '</h3><button class="x" data-close aria-label="Close">&times;</button></div><div class="db">' +
    '<div class="kv"><div><b>' + w.leadCount + '</b><span>Leads</span></div><div><b>' + w.claimedCount + '</b><span>Claimed</span></div><div><b>' + w.memberIds.length + '</b><span>Salespeople</span></div></div>' +
    '<h4>' + esc(catName(w.category)) + ' lists</h4>' + pickRows(d.lists.filter((l) => l.category === w.category).map((l) => ({ id: l.id, name: l.name + ' (' + l.leadCount + ')' })), F.lists, 'dlists') +
    '<h4>' + esc(catName(w.category)) + ' salespeople</h4>' + pickRows(d.people.filter((p) => p.role === 'sales' && p.category === w.category && p.active).map((p) => ({ id: p.id, name: p.name })), F.members, 'dmembers') +
    '<h4>Pipeline stages</h4><div class="stg">' + STAGE_LIST.map((s) => '<span>' + s + '</span>').join('') + '</div>' +
    '<p class="err" id="drawer-err" role="alert">' + esc(F.error) + '</p></div>' +
    '<div class="df">' +
    (F.confirm
      ? '<span class="muted" style="margin-right:auto;align-self:center">Remove this service?</span><button class="btn" data-cancel-remove>Keep</button><button class="btn danger" data-confirm-remove>Remove</button>'
      : '<button class="btn danger" data-remove-ws style="margin-right:auto">Remove</button><button class="btn dark" data-save-ws>Save changes</button>') +
    '</div>';
  el('drawer').hidden = false;
  el('scrim').hidden = false;
}
function closeAll(): void {
  el('drawer').hidden = true;
  el('modal').hidden = true;
  el('scrim').hidden = true;
  S.drawerId = null;
  S.form.drawer = null;
  closeMenu();
}

/* ---------- modals ---------- */
function singleCat(c: FormCat): Category {
  return c === 'both' ? dc() : c;
}
function catSeg(cur: FormCat, withBoth?: boolean): string {
  const options: FormCat[] = withBoth ? [...CATS, 'both'] : [...CATS];
  return '<div class="seg">' + options.map((c) => '<button type="button" data-fc="' + c + '" aria-pressed="' + (cur === c) + '">' + (c === 'both' ? 'Both' : esc(catName(c))) + '</button>').join('') + '</div>';
}
function mh(x: string): string {
  return '<div class="dh" style="border:0;padding-bottom:6px"><h3>' + x + '</h3><button class="x" data-close aria-label="Close">&times;</button></div>';
}
function dc(): Category {
  return S.cat === 'all' ? 'scale' : S.cat;
}
function wsPick(cat: Category): PickItem[] {
  return data()
    .workspaces.filter((w) => w.category === cat)
    .map((w) => ({ id: w.id, name: w.name }));
}
function salesPick(cat: Category): PickItem[] {
  return data()
    .people.filter((p) => p.role === 'sales' && p.category === cat && p.active)
    .map((p) => ({ id: p.id, name: p.name }));
}
function listPick(cat: Category): PickItem[] {
  return data()
    .lists.filter((l) => l.category === cat)
    .map((l) => ({ id: l.id, name: l.name + ' (' + l.leadCount + ')' }));
}
/** The sentence above the link: copy it yourself, or press the button to email it. */
function inviteBody(name: string, email: string, canEmail: boolean, reset: boolean): string {
  const what = reset ? 'a new password' : 'their own password';
  return canEmail
    ? 'Copy this link and send it to ' + name + ', or email it to ' + email + ' with the button below. They open it and choose ' + what + '.'
    : 'Copy this link and send it to ' + name + '. They open it and choose ' + what + '. Email is not set up yet.';
}
function newForm(): ModalForm {
  return { error: '', busy: false, id: '', name: '', email: '', role: 'sales', cat: dc(), members: [], lists: [], wss: [], csv: '', fileName: '', title: '', body: '', link: '', userId: '', canEmail: false, sent: false };
}
function openModal(kind: 'ws' | 'list' | 'person'): void;
function openModal(kind: 'editpeople' | 'rename' | 'category', personId: string): void;
function openModal(kind: 'link', info: LinkInfo): void;
function openModal(kind: ModalKind, extra?: string | LinkInfo): void {
  const F = newForm();
  if (kind === 'editpeople' || kind === 'rename' || kind === 'category') {
    const p = typeof extra === 'string' ? person(extra) : undefined;
    if (!p) return;
    F.id = p.id;
    F.name = p.name;
    F.role = p.role;
    F.cat = p.category ?? (p.role === 'manager' ? 'both' : dc());
    F.wss = p.workspaceIds.slice();
  } else if (kind === 'link') {
    if (typeof extra !== 'object') return;
    Object.assign(F, extra);
  }
  S.modal = kind;
  S.form.m = F;
  paintModal();
  el('scrim').hidden = false;
  el('modal').hidden = false;
  const f = el('modal').querySelector<HTMLInputElement>('input[type=text],input[type=email]');
  if (f) f.focus();
}
function syncFields(): void {
  const F = S.form.m;
  if (!F) return;
  const name = document.getElementById('f-name');
  if (name instanceof HTMLInputElement) F.name = name.value;
  const email = document.getElementById('f-email');
  if (email instanceof HTMLInputElement) F.email = email.value;
}
function paintModal(): void {
  const F = S.form.m;
  const k = S.modal;
  if (!F) return;
  let h = '';
  const foot = (label: string, save: string): string =>
    '<p class="err" role="alert">' + esc(F.error) + '</p></div><div class="df"><button class="btn" data-close>Cancel</button><button class="btn dark" data-save="' + save + '"' + (F.busy ? ' disabled' : '') + '>' + (F.busy ? 'One moment' : label) + '</button></div>';
  if (k === 'ws') {
    h =
      mh('Add service') + '<div class="mb"><label class="fl" for="f-name" style="margin-top:6px">Name</label><input class="inp" id="f-name" type="text" maxlength="40" placeholder="e.g. Google Ads" value="' + esc(F.name) + '">' +
      '<span class="fl">Category</span>' + catSeg(F.cat, true) +
      (F.cat === 'both'
        ? '<p class="hint">Creates ' + esc(F.name.trim() || 'this service') + ' in both Scale and Reach. Add lists and salespeople to each one afterwards.</p>'
        : '<span class="fl">' + esc(catName(F.cat)) + ' lists</span>' + pickRows(listPick(F.cat), F.lists, 'lists') +
          '<span class="fl">' + esc(catName(F.cat)) + ' salespeople</span>' + pickRows(salesPick(F.cat), F.members, 'members')) +
      foot('Create service', 'ws');
  } else if (k === 'list') {
    const cat = singleCat(F.cat);
    h =
      mh('Import list') + '<div class="mb"><label class="drop" style="margin-top:6px"><input id="f-file" type="file" accept=".csv,text/csv"><b>' + (F.fileName ? esc(F.fileName) : 'Choose a CSV file') + '</b>' + (F.fileName ? 'Choose a different file' : 'Phones, emails and areas are cleaned on import.') + '</label>' +
      '<label class="fl" for="f-name">List name</label><input class="inp" id="f-name" type="text" maxlength="80" placeholder="e.g. Salons, Bengaluru" value="' + esc(F.name) + '">' +
      '<span class="fl">Category</span>' + catSeg(F.cat) +
      '<span class="fl">Add to ' + esc(catName(cat)) + ' services</span>' + pickRows(wsPick(cat), F.wss, 'wss') + foot('Import', 'list');
  } else if (k === 'person') {
    const cat = singleCat(F.cat);
    const sa = F.role === 'superadmin';
    const roles: [Role, string][] = [['sales', 'Sales'], ['manager', 'Manager'], ['superadmin', 'Superadmin']];
    h =
      mh('Invite member') + '<div class="mb"><label class="fl" for="f-name" style="margin-top:6px">Name</label><input class="inp" id="f-name" type="text" maxlength="80" placeholder="Full name" value="' + esc(F.name) + '">' +
      '<label class="fl" for="f-email">Email</label><input class="inp" id="f-email" type="email" maxlength="200" placeholder="name@company.com" value="' + esc(F.email) + '">' +
      '<span class="fl">Role</span><div class="seg">' + roles.map((r) => '<button type="button" data-rl="' + r[0] + '" aria-pressed="' + (F.role === r[0]) + '">' + r[1] + '</button>').join('') + '</div>' +
      (sa
        ? '<p class="hint">Superadmins can see both categories and every workspace.</p>'
        : F.role === 'manager'
          ? '<span class="fl">Category</span>' + catSeg(F.cat, true) + '<p class="hint">Managers can look at the team and every lead in their category, but cannot change anything.</p>'
          : '<span class="fl">Category</span>' + catSeg(F.cat) + '<span class="fl">' + esc(catName(cat)) + ' services</span>' + pickRows(wsPick(cat), F.wss, 'wss')) +
      foot('Create invite link', 'person');
  } else if (k === 'category') {
    const sales = F.role === 'sales';
    const to = singleCat(F.cat);
    h =
      mh('Change category for ' + esc(F.name)) + '<div class="mb"><span class="fl" style="margin-top:6px">Category</span>' + catSeg(F.cat, !sales) +
      (sales
        ? '<span class="fl">' + esc(catName(to)) + ' services</span>' + pickRows(wsPick(to), F.wss, 'wss') + '<p class="hint">Their current services are removed when the category changes. They can only be moved while they own no leads.</p>'
        : '<p class="hint">Scale, Reach or both: what this manager can look at.</p>') +
      foot('Save', 'category');
  } else if (k === 'rename') {
    h = mh('Edit name') + '<div class="mb"><label class="fl" for="f-name" style="margin-top:6px">Name</label><input class="inp" id="f-name" type="text" maxlength="80" value="' + esc(F.name) + '"><p class="hint">This is how they appear to the team and in reports.</p>' + foot('Save', 'rename');
  } else if (k === 'editpeople') {
    const cat = singleCat(F.cat);
    h = mh('Services for ' + esc(F.name)) + '<div class="mb"><p class="hint" style="margin-top:0">' + esc(catName(cat)) + ' services only.</p>' + pickRows(wsPick(cat), F.wss, 'wss') + foot('Save', 'editpeople');
  } else if (k === 'link') {
    h =
      mh(esc(F.title)) + '<div class="mb"><p style="margin:6px 0 10px">' + esc(F.body) + '</p><input class="inp" id="invite-link" type="text" readonly value="' + esc(F.link) + '" onclick="this.select()" aria-label="Invite link"><p class="hint">It works once and expires in 7 days. Send it only to ' + esc(F.name) + '. A new link replaces this one.</p></div><div class="df"><button class="btn" data-copy-link>Copy link</button>' + (F.canEmail ? '<button class="btn" data-send-link' + (F.sent || F.busy ? ' disabled' : '') + '>' + (F.sent ? 'Email sent' : F.busy ? 'Sending' : 'Send email') + '</button>' : '') + '<button class="btn dark" data-close>Done</button></div>';
  }
  el('modal').innerHTML = h;
}

/* ---------- owner menu ---------- */
function closeMenu(): void {
  const m = document.querySelector('.menu');
  if (m) m.remove();
}
function openMenu(btn: HTMLElement, leadId: string, wsId: string): void {
  closeMenu();
  const row = S.leads.res?.leads.find((l) => l.id === leadId);
  const w = ws(wsId);
  if (!row || !w) return;
  const o = row.owners[w.key];
  const cur = o && o.id;
  const people = data().people.filter((p) => p.role === 'sales' && p.active && p.workspaceIds.indexOf(wsId) > -1);
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML =
    '<div class="t">' + esc(catName(w.category)) + ', ' + esc(w.name) + ' owner</div>' +
    (people.length
      ? people.map((p) => '<button data-set="' + esc(leadId) + '|' + esc(wsId) + '|' + esc(p.id) + '">' + av(p) + esc(p.name) + (cur === p.id ? '<span class="ck">&#10003;</span>' : '') + '</button>').join('')
      : '<div class="t">No active salespeople in this workspace.</div>') +
    '<button data-set="' + esc(leadId) + '|' + esc(wsId) + '|" style="color:var(--muted)">Release to unassigned' + (!cur ? '<span class="ck">&#10003;</span>' : '') + '</button>';
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect();
  const mw = m.offsetWidth;
  const mh2 = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8)) + 'px';
  m.style.top = (r.bottom + mh2 + 12 > window.innerHeight ? Math.max(8, r.top - mh2 - 4) : r.bottom + 4) + 'px';
}

/* ---------- actions ---------- */
function toggle(arr: string[], v: string): void {
  const i = arr.indexOf(v);
  if (i > -1) arr.splice(i, 1);
  else arr.push(v);
}

/** What to do once a dialog's request succeeds: a toast, the page to land on, and an optional follow-up. */
interface SaveOutcome {
  msg?: string;
  view: View;
  after?: () => void;
}
type SaveKind = 'ws' | 'list' | 'person' | 'editpeople' | 'rename' | 'category';
function isSaveKind(v: string | undefined): v is SaveKind {
  return v === 'ws' || v === 'list' || v === 'person' || v === 'editpeople' || v === 'rename' || v === 'category';
}

function save(kind: SaveKind): void {
  syncFields();
  const F = S.form.m;
  if (!F) return;
  F.error = '';
  let req: Promise<SaveOutcome>;
  if (kind === 'ws') {
    if (F.name.trim().length < 2) {
      F.error = 'Give the service a name.';
      return paintModal();
    }
    const body: WorkspaceCreateBody = { name: F.name.trim(), category: F.cat, listIds: F.lists, memberIds: F.members };
    req = api<unknown>('POST', '/api/admin/workspaces', body).then(() => ({
      msg: F.name.trim() + ' service created in ' + (F.cat === 'both' ? 'Scale and Reach' : catName(F.cat)),
      view: 'workspaces',
    }));
  } else if (kind === 'list') {
    if (!F.csv) {
      F.error = 'Choose a CSV file.';
      return paintModal();
    }
    if (F.name.trim().length < 2) {
      F.error = 'Give the list a name.';
      return paintModal();
    }
    const body: ListCreateBody = { name: F.name.trim(), category: singleCat(F.cat), fileName: F.fileName || 'import.csv', csv: F.csv, workspaceIds: F.wss };
    req = api<ListImportResult>('POST', '/api/admin/lists', body).then((r) => ({
      msg: 'Imported ' + r.added + ' stores' + (r.duplicates ? ' (' + r.duplicates + ' already existed)' : ''),
      view: 'lists',
    }));
  } else if (kind === 'person') {
    if (F.name.trim().length < 2) {
      F.error = 'Enter the full name.';
      return paintModal();
    }
    if (!/^\S+@\S+\.\S+$/.test(F.email.trim())) {
      F.error = 'Enter a valid email address.';
      return paintModal();
    }
    const body: UserCreateBody = { name: F.name.trim(), email: F.email.trim(), role: F.role, workspaceIds: F.role === 'sales' ? F.wss : [] };
    if (F.role === 'sales') body.category = singleCat(F.cat);
    else if (F.role === 'manager' && F.cat !== 'both') body.category = F.cat;
    req = api<UserCreateResult>('POST', '/api/admin/users', body).then((r) => ({
      after: () => {
        openModal('link', {
          title: 'Invite link for ' + body.name,
          body: inviteBody(body.name, body.email, r.canEmail, false),
          link: r.inviteUrl,
          name: body.name,
          userId: r.id,
          email: body.email,
          canEmail: r.canEmail,
        });
      },
      view: 'team',
    }));
  } else if (kind === 'category') {
    const cur = person(F.id);
    if (!cur) return;
    if ((cur.category ?? 'both') === F.cat) {
      F.error = 'They are already in that category.';
      return paintModal();
    }
    const body: { category: FormCat; workspaceIds?: string[] } = { category: F.cat };
    if (F.role === 'sales') body.workspaceIds = F.wss;
    req = api<unknown>('PATCH', '/api/admin/users/' + F.id, body).then(() => ({
      msg: F.name + ' moved to ' + (F.cat === 'both' ? 'Scale and Reach' : catName(F.cat)),
      view: 'team',
    }));
  } else if (kind === 'rename') {
    if (F.name.trim().length < 2) {
      F.error = 'Enter the full name.';
      return paintModal();
    }
    req = api<unknown>('PATCH', '/api/admin/users/' + F.id, { name: F.name.trim() }).then(() => ({ msg: 'Name updated', view: 'team' }));
  } else {
    req = api<unknown>('PATCH', '/api/admin/users/' + F.id, { workspaceIds: F.wss }).then(() => ({ msg: 'Workspaces updated', view: 'team' }));
  }
  F.busy = true;
  paintModal();
  req
    .then((res) => {
      S.form.m = null;
      el('modal').hidden = true;
      el('scrim').hidden = true;
      return reload(() => {
        S.view = res.view;
      }).then(() => {
        if (res.msg) toast(res.msg);
        if (res.view === 'leads') loadLeads();
        if (res.after) res.after();
      });
    })
    .catch((e: unknown) => {
      F.busy = false;
      F.error = messageOf(e, 'Something went wrong.');
      paintModal();
    });
}

type PickKey = 'lists' | 'members' | 'wss';
function pickKey(v: string | undefined): PickKey | null {
  if (v === 'lists' || v === 'members' || v === 'wss') return v;
  return v === 'pwss' ? 'wss' : null;
}

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
    if (isView(v)) goto(v);
    return;
  }
  if ((c = hit('[data-cat]'))) {
    const next = c.dataset['cat'];
    if (!isCategoryFilter(next)) return;
    S.cat = next;
    closeAll();
    S.leads.res = null;
    S.leads.page = 1;
    render();
    if (S.view === 'leads') loadLeads();
    return;
  }
  if ((c = hit('[data-own]'))) {
    e.stopPropagation();
    const p = (c.dataset['own'] ?? '').split('|');
    openMenu(c, p[0], p[1]);
    return;
  }
  if ((c = hit('[data-set]'))) {
    const q = (c.dataset['set'] ?? '').split('|');
    closeMenu();
    api<unknown>('PUT', '/api/admin/leads/' + encodeURIComponent(q[0]) + '/owners/' + encodeURIComponent(q[1]), { ownerId: q[2] || null })
      .then(() => {
        const owner = q[2] ? person(q[2]) : undefined;
        toast(q[2] ? 'Reassigned to ' + (owner ? owner.name : '') : 'Released to unassigned');
        loadLeads(false);
        void reload();
      })
      .catch(fail);
    return;
  }
  if (!hit('.menu')) closeMenu();
  if ((c = hit('[data-ws]'))) {
    S.form.drawer = null;
    openDrawer(c.dataset['ws'] ?? '');
    return;
  }
  if ((c = hit('[data-ltoggle]'))) {
    const lid = c.dataset['ltoggle'] ?? '';
    const lst = data().lists.find((x) => x.id === lid);
    api<unknown>('PATCH', '/api/admin/lists/' + encodeURIComponent(lid), { active: !!(lst && lst.archived) })
      .then(() => {
        toast(lst && lst.archived ? 'List activated' : 'List deactivated');
        return reload();
      })
      .catch((err: unknown) => {
        toast(messageOf(err, ''));
      });
    return;
  }
  if ((c = hit('[data-lask]'))) {
    S.listConfirm = c.dataset['lask'] ?? null;
    render();
    return;
  }
  if (hit('[data-lcancel]')) {
    S.listConfirm = null;
    render();
    return;
  }
  if ((c = hit('[data-ldel]'))) {
    api<unknown>('DELETE', '/api/admin/lists/' + encodeURIComponent(c.dataset['ldel'] ?? ''))
      .then(() => {
        S.listConfirm = null;
        toast('List removed');
        return reload();
      })
      .catch((err: unknown) => {
        S.listConfirm = null;
        toast(messageOf(err, ''));
        render();
      });
    return;
  }
  if ((c = hit('[data-new]'))) {
    const kind = c.dataset['new'];
    if (kind === 'ws' || kind === 'list' || kind === 'person') openModal(kind);
    return;
  }
  if ((c = hit('[data-chcat]'))) {
    openModal('category', c.dataset['chcat'] ?? '');
    return;
  }
  if ((c = hit('[data-rename]'))) {
    openModal('rename', c.dataset['rename'] ?? '');
    return;
  }
  if ((c = hit('[data-editpeople]'))) {
    openModal('editpeople', c.dataset['editpeople'] ?? '');
    return;
  }
  if (hit('[data-close]') || (t instanceof HTMLElement && t.id === 'scrim')) {
    closeAll();
    S.modal = null;
    return;
  }
  if ((c = hit('[data-fc]'))) {
    syncFields();
    const F = S.form.m;
    const next = c.dataset['fc'];
    if (!F || !isFormCat(next)) return;
    if (F.cat !== next) {
      F.cat = next;
      F.lists = [];
      F.members = [];
      F.wss = [];
    }
    paintModal();
    return;
  }
  if ((c = hit('[data-rl]'))) {
    syncFields();
    const role = c.dataset['rl'];
    if (S.form.m && isRole(role)) S.form.m.role = role;
    paintModal();
    return;
  }
  if ((c = hit('[data-pk]'))) {
    const k = (c.dataset['pk'] ?? '').split('|');
    if (k[0] === 'dlists' || k[0] === 'dmembers') {
      const d = S.form.drawer;
      if (!d) return;
      toggle(k[0] === 'dlists' ? d.lists : d.members, k[1]);
      d.error = '';
      openDrawer(d.id);
      return;
    }
    syncFields();
    const Fm = S.form.m;
    const key = pickKey(k[0]);
    if (!Fm || !key) return;
    if (k[1] === '*') {
      const ids = (k[0] === 'wss' ? wsPick(singleCat(Fm.cat)) : k[0] === 'members' ? salesPick(singleCat(Fm.cat)) : data().lists.filter((l) => l.category === Fm.cat)).map((it) => it.id);
      const cur = Fm[key];
      Fm[key] = ids.every((id) => cur.indexOf(id) > -1) ? [] : ids.slice();
      paintModal();
      return;
    }
    toggle(Fm[key], k[1]);
    paintModal();
    return;
  }
  if ((c = hit('[data-save]'))) {
    const kind = c.dataset['save'];
    if (isSaveKind(kind)) save(kind);
    return;
  }
  if (hit('[data-save-ws]')) {
    const dd = S.form.drawer;
    if (!dd) return;
    api<unknown>('PUT', '/api/admin/workspaces/' + encodeURIComponent(dd.id), { listIds: dd.lists, memberIds: dd.members })
      .then(() => {
        toast('Service updated');
        closeAll();
        return reload();
      })
      .catch((err: unknown) => {
        dd.error = messageOf(err, '');
        openDrawer(dd.id);
      });
    return;
  }
  if (hit('[data-remove-ws]')) {
    const d = S.form.drawer;
    if (!d) return;
    d.confirm = true;
    openDrawer(d.id);
    return;
  }
  if (hit('[data-cancel-remove]')) {
    const d = S.form.drawer;
    if (!d) return;
    d.confirm = false;
    openDrawer(d.id);
    return;
  }
  if (hit('[data-confirm-remove]')) {
    const rd: DrawerForm | null = S.form.drawer;
    if (!rd) return;
    api<unknown>('DELETE', '/api/admin/workspaces/' + encodeURIComponent(rd.id))
      .then(() => {
        toast('Service removed');
        closeAll();
        return reload();
      })
      .catch((err: unknown) => {
        rd.confirm = false;
        rd.error = messageOf(err, '');
        openDrawer(rd.id);
      });
    return;
  }
  if ((c = hit('[data-uask]'))) {
    S.userConfirm = c.dataset['uask'] ?? null;
    render();
    return;
  }
  if (hit('[data-ucancel]')) {
    S.userConfirm = null;
    render();
    return;
  }
  if ((c = hit('[data-udel]'))) {
    const gone = person(c.dataset['udel'] ?? '');
    if (!gone) return;
    api<unknown>('DELETE', '/api/admin/users/' + encodeURIComponent(gone.id))
      .then(() => {
        S.userConfirm = null;
        toast(gone.name + ' deleted');
        return reload();
      })
      .catch((err: unknown) => {
        S.userConfirm = null;
        toast(messageOf(err, ''));
        render();
      });
    return;
  }
  if ((c = hit('[data-toggle]'))) {
    const u = person(c.dataset['toggle'] ?? '');
    if (!u) return;
    api<unknown>('PATCH', '/api/admin/users/' + encodeURIComponent(u.id), { active: !u.active })
      .then(() => {
        toast(u.name + (u.active ? ' deactivated' : ' reactivated'));
        return reload();
      })
      .catch(fail);
    return;
  }
  if ((c = hit('[data-reset]'))) {
    const rp = person(c.dataset['reset'] ?? '');
    if (!rp) return;
    api<InviteResult>('POST', '/api/admin/users/' + encodeURIComponent(rp.id) + '/invite')
      .then((r) => {
        openModal('link', {
          title: (r.reset ? 'Password reset link for ' : 'Invite link for ') + rp.name,
          body: inviteBody(rp.name, rp.email, r.canEmail, r.reset),
          link: r.inviteUrl,
          name: rp.name,
          userId: rp.id,
          email: rp.email,
          canEmail: r.canEmail,
        });
      })
      .catch(fail);
    return;
  }
  if ((c = hit('[data-save-targets]'))) {
    const cat = c.dataset['saveTargets'];
    if (!isCategory(cat)) return;
    const g = (m: Metric): number => parseInt(el<HTMLInputElement>('t-' + cat + '-' + m).value, 10);
    const body: TargetsBody = { category: cat, contacted: g('contacted'), won: g('won') };
    if ([body.contacted, body.won].some((n) => !(n >= 0))) {
      toast('Targets must be whole numbers, zero or more.');
      return;
    }
    api<unknown>('PUT', '/api/admin/targets', body)
      .then(() => {
        const targets = data().targets;
        targets[cat] = { contacted: body.contacted, meetings: targets[cat]?.meetings || 0, won: body.won };
        toast(catName(cat) + ' targets saved');
      })
      .catch(fail);
    return;
  }
  if ((c = hit('[data-rmonth]'))) {
    const d = parseInt(c.dataset['rmonth'] ?? '0', 10);
    let m = S.report.m + d;
    let y = S.report.y;
    if (m < 0) {
      m = 11;
      y--;
    } else if (m > 11) {
      m = 0;
      y++;
    }
    if (y > NOW.getFullYear() || (y === NOW.getFullYear() && m > NOW.getMonth())) return;
    S.report.m = m;
    S.report.y = y;
    render();
    return;
  }
  if ((c = hit('[data-lpage]'))) {
    S.leads.page += parseInt(c.dataset['lpage'] ?? '0', 10);
    loadLeads();
    return;
  }
  if (hit('[data-send-link]')) {
    const F = S.form.m;
    if (!F || F.busy || F.sent) return;
    const token = F.link.split('/').pop() ?? '';
    F.busy = true;
    F.error = '';
    paintModal();
    api<{ ok: boolean; sentTo: string }>('POST', '/api/admin/users/' + encodeURIComponent(F.userId) + '/invite/email', { token })
      .then((r) => {
        F.busy = false;
        F.sent = true;
        paintModal();
        toast('Email sent to ' + r.sentTo);
      })
      .catch((err: unknown) => {
        F.busy = false;
        paintModal();
        toast(messageOf(err, 'We could not send the email.'));
      });
    return;
  }
  if (hit('[data-copy-link]')) {
    const txt = S.form.m?.link ?? '';
    const fld = document.getElementById('invite-link');
    if (fld instanceof HTMLInputElement) fld.select();
    const manual = (): void => toast('Select the link and copy it');
    try {
      navigator.clipboard.writeText(txt).then(() => toast('Link copied'), manual);
    } catch {
      manual();
    }
  }
});

document.addEventListener('change', (e) => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || input.id !== 'f-file') return;
  const file = input.files && input.files[0];
  if (!file) return;
  const form = S.form.m;
  if (!form) return;
  if (file.size > 20 * 1024 * 1024) {
    form.error = 'That file is over 20 MB.';
    return paintModal();
  }
  const reader = new FileReader();
  reader.onload = () => {
    syncFields();
    const F = S.form.m;
    if (!F) return;
    F.csv = String(reader.result);
    F.fileName = file.name;
    F.error = '';
    if (!F.name.trim()) F.name = file.name.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ').trim();
    paintModal();
  };
  reader.onerror = () => {
    const F = S.form.m;
    if (!F) return;
    F.error = 'That file could not be read.';
    paintModal();
  };
  reader.readAsText(file);
});

let searchTimer: number | undefined;
document.addEventListener('input', (e) => {
  const input = e.target;
  if (input instanceof HTMLInputElement && input.id === 'lq') {
    S.leads.q = input.value;
    S.leads.page = 1;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      loadLeads(true);
    }, 250);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAll();
    S.modal = null;
  }
});

const embedded = takeEmbedded<Bootstrap>();
if (embedded) {
  D = embedded;
  render();
} else {
  void reload();
}

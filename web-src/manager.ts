import { api, messageOf } from './admin/api.js';
import type { Category, LeadsPage, ManagerBootstrap, ManagerView, TeamMember, VerificationItem, Workspace } from './manager/types.js';
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
  editName: boolean;
  verifyUser: { id: string; name: string } | null;
  verifications: VerificationItem[] | null;
  loadingVerifications: boolean;
  editingClaimId: string | null;
}

const S: State = {
  view: 'team',
  cat: 'all',
  q: '',
  page: 1,
  leads: null,
  editName: false,
  verifyUser: null,
  verifications: null,
  loadingVerifications: false,
  editingClaimId: null,
};
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
  let h = head('Team', 'Salespeople, monthly closed claims, and verifications, ' + sub());
  h +=
    '<div class="tw cards team"><table><thead><tr><th style="width:1%;white-space:nowrap">Sr. no</th><th>Name</th><th>Category</th><th>Services</th><th>Assigned</th><th>Contacted</th><th>Closed</th><th>Status</th></tr></thead><tbody>' +
    (people.length
      ? people
          .map((p, i) => {
            const state = !p.active ? 'Deactivated' : p.invited ? 'Invited' : 'Active';
            const won = p.stats.won;
            const vWon = p.stats.verifiedWon ?? 0;
            const closedTd = won > 0
              ? '<td data-label="Closed" data-l="closed"><div class="v-cell"><button type="button" class="btn sm v-review-btn" data-verify-user="' + p.id + '" data-verify-name="' + esc(p.name) + '" title="Verify closed claims"><b class="num">' + vWon + '</b><span class="v-slash"> / ' + won + ' verified</span><span class="v-chip">Verify</span></button></div></td>'
              : '<td data-label="Closed" data-l="closed">' + num(0) + '</td>';
            return (
              '<tr><td class="muted num" data-l="n">' + (i + 1) + '</td><td data-l="name"><span class="own static"><span class="av">' + esc(p.ini) + '</span><span>' + esc(p.name) + '</span></span></td><td data-l="cat">' +
              (p.category ? ct(p.category) : '') + '</td><td data-label="Services" data-l="svc">' + chips(p) + '</td><td data-label="Assigned">' + num(p.stats.assigned) + '</td><td data-label="Contacted">' + num(p.stats.contacted) + '</td>' + closedTd +
              '<td data-l="state"><span class="dotl' + (p.active && !p.invited ? '' : ' off') + '"><i></i>' + state + '</span></td></tr>'
            );
          })
          .join('')
      : '<tr><td colspan="8"><div class="empty"><b>No salespeople yet</b>They appear here once a superadmin invites them.</div></td></tr>') +
    '</tbody></table></div>';
  return h + '<p class="hint">Assigned is everything a person owns. Contacted and Closed count this month. Managers review claimed closed deals to confirm validity.</p>';
}

function vVerifyModal(): string {
  if (!S.verifyUser) return '';
  const u = S.verifyUser;
  const items = S.verifications;
  const total = items ? items.length : 0;
  const verified = items ? items.filter((x) => x.verified === 1).length : 0;
  const rejected = items ? items.filter((x) => x.verified === 2).length : 0;
  const pending = items ? items.filter((x) => x.verified === 0).length : 0;

  let body: string;
  if (S.loadingVerifications) {
    body = '<div class="empty">Loading claimed closed leads...</div>';
  } else if (!items || items.length === 0) {
    body = '<div class="empty"><b>No closed claims found</b>' + esc(u.name) + ' has no claimed closed leads to verify this month.</div>';
  } else {
    body =
      '<table class="vtable">' +
      '<thead><tr>' +
      '<th class="td-num">#</th>' +
      '<th>Lead / Store</th>' +
      '<th>Salesperson Note</th>' +
      '<th>Status</th>' +
      '<th>Manager Action</th>' +
      '<th>Manager Reason / Note</th>' +
      '</tr></thead>' +
      '<tbody>' +
      items.map((item, i) => {
        const isTrue = item.verified === 1;
        const isFalse = item.verified === 2;
        const rowClass = isTrue ? ' row-verified' : isFalse ? ' row-rejected' : '';
        const badge = isTrue
          ? '<span class="v-lead-badge v-lead-true"><svg viewBox="0 0 10 8" class="v-mb-ic" aria-hidden="true"><path d="M1 4l2.5 2.5L9 1"/></svg>Verified</span>'
          : isFalse
            ? '<span class="v-lead-badge v-lead-false"><svg viewBox="0 0 8 8" class="v-mb-ic" aria-hidden="true"><path d="M1 1l6 6M7 1L1 7"/></svg>Rejected</span>'
            : '<span class="v-lead-badge v-lead-pending"><svg viewBox="0 0 8 8" class="v-mb-ic" aria-hidden="true"><circle cx="4" cy="4" r="3"/></svg>Pending</span>';
        const subTxt = [item.leadCompany, item.leadArea || item.leadCity, item.leadPhone].filter(Boolean).join(' · ');
        const isEditingStage = S.editingClaimId === item.id;
        const stageControl = isEditingStage
          ? '<div class="vm-stage-edit">' +
            '<select class="inp sm vm-stage-sel" data-stage-sel="' + item.id + '">' +
            ['Won', 'Negotiation', 'Meeting', 'Interested', 'Contacted', 'Lost'].map((st) => '<option value="' + st + '"' + (st === item.status ? ' selected' : '') + '>' + st + '</option>').join('') +
            '</select>' +
            '<button type="button" class="btn sm dark" data-save-stage="' + item.id + '">Save</button>' +
            '<button type="button" class="btn sm" data-cancel-stage aria-label="Cancel">✕</button>' +
            '</div>'
          : '<button type="button" class="stage-pill-btn" data-toggle-stage="' + item.id + '">Stage: ' + esc(item.status) + ' ▾</button>';

        return (
          '<tr class="' + rowClass + '" data-card-cid="' + item.id + '">' +
          '<td class="td-num">' + (i + 1) + '</td>' +
          '<td class="lead-col">' +
          '<div class="lead-name">' + esc(item.leadName) + '<span class="tag-chip">' + esc(item.workspaceName) + '</span>' + (item.workspaceCategory ? ct(item.workspaceCategory) : '') + '</div>' +
          (subTxt ? '<div class="lead-sub">' + esc(subTxt) + '</div>' : '') +
          '</td>' +
          '<td class="note-col">' +
          (item.latestNote ? '<div class="sales-note-box">' + esc(item.latestNote) + '</div>' : '<span class="muted" style="font-size:12px">None</span>') +
          '</td>' +
          '<td class="status-col">' + badge + '</td>' +
          '<td class="actions-col">' +
          '<div class="act-toggle-grp">' +
          '<button type="button" class="act-tbtn' + (isTrue ? ' is-true' : '') + '" data-verify-act="1" data-cid="' + item.id + '" title="Mark as Verified">✓ True</button>' +
          '<button type="button" class="act-tbtn' + (isFalse ? ' is-false' : '') + '" data-verify-act="2" data-cid="' + item.id + '" title="Mark as Rejected">✕ False</button>' +
          '</div>' +
          '<div>' + stageControl + '</div>' +
          '</td>' +
          '<td class="mgr-note-col">' +
          '<input type="text" class="mgr-inp" placeholder="Optional reason / note..." data-note-cid="' + item.id + '" value="' + esc(item.verificationNote || '') + '">' +
          '</td>' +
          '</tr>'
        );
      }).join('') +
      '</tbody></table>';
  }

  return (
    '<div class="backdrop" data-close-verify></div>' +
    '<div class="modal verify-modal" role="dialog" aria-modal="true" aria-labelledby="vm-title">' +
    '<div class="modal-h">' +
    '<div><h2 id="vm-title">Verify Closed Claims · ' + esc(u.name) + '</h2>' +
    '<span class="sub">' + (items ? '<b class="c-true">' + verified + ' verified</b> · <span class="c-false">' + rejected + ' rejected</span> · <span class="c-pending">' + pending + ' pending</span> (Total: ' + total + ' claimed)' : 'Checking records...') + '</span>' +
    '</div>' +
    '<button type="button" class="drawer-x" data-close-verify aria-label="Close modal">×</button>' +
    '</div>' +
    '<div class="modal-b">' + body + '</div>' +
    '<div class="modal-f"><button type="button" class="btn dark" data-close-verify>Done</button></div>' +
    '</div>'
  );
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
  const who = S.editName
    ? '<form class="acct acct-edit" id="nameform"><span class="av">' + esc(d.me.ini) + '</span><div><label class="fl" for="nm">Full name</label><input class="inp" id="nm" type="text" maxlength="80" autocomplete="name" value="' + esc(d.me.name) + '"><p class="err" id="nm-err" role="alert"></p><div class="acct-btns"><button type="button" class="btn" data-cancelname>Cancel</button><button type="submit" class="btn dark" id="nm-go">Save name</button></div></div></form>'
    : '<div class="acct"><span class="av">' + esc(d.me.ini) + '</span><div><b>' + esc(d.me.name) + '</b><small>' + esc(d.me.email) + '</small></div><button type="button" class="ib" data-editname title="Edit name" aria-label="Edit name"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 7.5l3 3"/></svg></button></div>';
  return (
    head('Account', 'Manager') +
    who +
    '<p class="hint">You can look at the team and every lead in ' + esc(seeing) + '. Managers can also review and verify closed leads.</p>' +
    '<button type="button" class="btn dark acct-out" data-signout>Sign out</button>'
  );
}

function render(keepFocus?: boolean): void {
  nav();
  const view = el('view');
  const focused = keepFocus && document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
  const caret = focused ? focused.selectionStart : null;
  view.innerHTML = (S.view === 'account' ? vAccount() : (S.view === 'team' ? vTeam() : vLeads())) + vVerifyModal();
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

function openVerificationModal(userId: string, name: string): void {
  S.verifyUser = { id: userId, name };
  S.loadingVerifications = true;
  S.verifications = null;
  S.editingClaimId = null;
  render();
  api<VerificationItem[]>('GET', '/api/manager/verifications?userId=' + encodeURIComponent(userId))
    .then((items) => {
      S.verifications = items;
      S.loadingVerifications = false;
      render();
    })
    .catch((e: unknown) => {
      S.loadingVerifications = false;
      fail(e);
      render();
    });
}

let searchTimer: number | undefined;

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'nameform') return;
  e.preventDefault();
  const input = el<HTMLInputElement>('nm');
  const err = el('nm-err');
  const go = el<HTMLButtonElement>('nm-go');
  const name = input.value.trim();
  err.textContent = '';
  if (name.length < 2) {
    err.textContent = 'Enter your full name.';
    return;
  }
  go.disabled = true;
  go.textContent = 'One moment';
  api<{ name: string; ini: string }>('PATCH', '/api/auth/me', { name })
    .then((r) => {
      const d = data();
      d.me.name = r.name;
      d.me.ini = r.ini;
      S.editName = false;
      render();
      toast('Name updated');
    })
    .catch((error: unknown) => {
      go.disabled = false;
      go.textContent = 'Save name';
      err.textContent = messageOf(error);
    });
});

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
  if (hit('[data-editname]')) {
    S.editName = true;
    render();
    const input = document.getElementById('nm');
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
    return;
  }
  if (hit('[data-cancelname]')) {
    S.editName = false;
    render();
    return;
  }
  if ((c = hit('[data-lpage]'))) {
    const step = Number(c.dataset['lpage']);
    S.page = Math.max(1, S.page + (step < 0 ? -1 : 1));
    loadLeads();
    return;
  }

  // Verification modal handlers
  if ((c = hit('[data-verify-user]'))) {
    const uid = c.dataset['verifyUser'];
    const uname = c.dataset['verifyName'] || 'Salesperson';
    if (uid) openVerificationModal(uid, uname);
    return;
  }
  if (hit('[data-close-verify]')) {
    S.verifyUser = null;
    S.verifications = null;
    S.editingClaimId = null;
    render();
    return;
  }
  if ((c = hit('[data-verify-act]'))) {
    const act = Number(c.dataset['verifyAct']) as 1 | 2;
    const cid = c.dataset['cid'];
    if (!cid) return;
    const noteInp = document.querySelector<HTMLInputElement>('[data-note-cid="' + cid + '"]');
    const note = noteInp ? noteInp.value.trim() : undefined;
    api<{ ok: boolean; verified: number; status: string }>('PATCH', '/api/manager/claims/' + cid + '/verify', { verified: act, note })
      .then((res) => {
        if (S.verifications) {
          const item = S.verifications.find((x) => x.id === cid);
          if (item) {
            item.verified = res.verified;
            if (note !== undefined) item.verificationNote = note || null;
          }
        }
        if (S.verifyUser) {
          const person = data().people.find((p) => p.id === S.verifyUser?.id);
          if (person && S.verifications) {
            person.stats.verifiedWon = S.verifications.filter((x) => x.verified === 1).length;
          }
        }
        render();
        toast(act === 1 ? 'Marked as Verified (True)' : 'Marked as Rejected (False)');
      })
      .catch(fail);
    return;
  }
  if ((c = hit('[data-toggle-stage]'))) {
    const cid = c.dataset['toggleStage'];
    if (cid) {
      S.editingClaimId = S.editingClaimId === cid ? null : cid;
      render();
    }
    return;
  }
  if ((c = hit('[data-save-stage]'))) {
    const cid = c.dataset['saveStage'];
    if (!cid) return;
    const sel = document.querySelector<HTMLSelectElement>('[data-stage-sel="' + cid + '"]');
    const newStage = sel ? sel.value : 'Won';
    const act = newStage === 'Won' ? 1 : 2;
    api<{ ok: boolean; verified: number; status: string }>('PATCH', '/api/manager/claims/' + cid + '/verify', { verified: act, status: newStage })
      .then((res) => {
        if (S.verifications) {
          const item = S.verifications.find((x) => x.id === cid);
          if (item) {
            item.status = res.status;
            item.verified = res.verified;
          }
        }
        if (S.verifyUser) {
          const person = data().people.find((p) => p.id === S.verifyUser?.id);
          if (person && S.verifications) {
            person.stats.won = S.verifications.filter((x) => x.status === 'Won').length;
            person.stats.verifiedWon = S.verifications.filter((x) => x.status === 'Won' && x.verified === 1).length;
          }
        }
        S.editingClaimId = null;
        render();
        toast('Stage updated to ' + newStage);
      })
      .catch(fail);
    return;
  }
  if (hit('[data-cancel-stage]')) {
    S.editingClaimId = null;
    render();
    return;
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

import { api, messageOf } from './admin/api.js';
import type { Category, LeadsPage, ManagerBootstrap, ManagerView, PersonLead, PersonLeads, Period, TeamMember, VerificationItem, Workspace } from './manager/types.js';
import { takeEmbedded } from './shared/boot.js';
import { el } from './shared/dom.js';
import { initPwa } from './shared/pwa.js';

initPwa();

const ICON: Record<'team' | 'leads', string> = {
  team: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.5-3.2 2.8-4.8 5.5-4.8s5 1.6 5.5 4.8"/><path d="M15.5 5.6a3.1 3.1 0 0 1 0 5.8M17.5 14.5c1.7.6 2.7 2 3 4.5"/></svg>',
  leads: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.6-3.6 3.5-5.5 7-5.5s6.4 1.9 7 5.5"/></svg>',
};
const ACCOUNT_ICON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.6-3.4 3.4-5.2 7-5.2s6.4 1.8 7 5.2"/></svg>';
const SEARCH = '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>';

type CategoryFilter = Category | 'all';

const EYE = '<svg class="cta-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const SHIELD = '<svg class="cta-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7.5 3v5.5c0 4.6-3.1 8-7.5 9.5-4.4-1.5-7.5-4.9-7.5-9.5V6z"/><path d="M8.7 12.2l2.4 2.4 4.3-4.8"/></svg>';
const CAL = '<svg class="cta-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';
const PERIODS: [Period, string][] = [['today', 'Today'], ['week', 'This week'], ['month', 'This month']];

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
  /** The window the Team numbers cover. */
  period: Period;
  /** The day shown when the period is a chosen date (YYYY-MM-DD). */
  date: string;
  /** The calendar for choosing that day: whether it is open, and the month it shows. */
  dpOpen: boolean;
  dpY: number;
  dpM: number;
  /** The salesperson whose leads are open in the popup, and those leads once loaded. */
  leadsUser: { id: string; name: string } | null;
  personLeads: PersonLead[] | null;
  /** The stage the leads popup is narrowed to ('all' shows every lead). */
  leadStage: string;
  /** Which lead cards have their notes open. */
  openLead: Record<string, boolean>;
  /** True right after a switch to the leads view, so its first load drops in like the other sections. */
  leadsFresh: boolean;
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
  period: 'month',
  date: '',
  dpOpen: false,
  dpY: new Date().getFullYear(),
  dpM: new Date().getMonth(),
  leadsUser: null,
  personLeads: null,
  leadStage: 'all',
  openLead: {},
  leadsFresh: false,
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
  return '<span class="ct">' + esc(catName(c)) + '</span>';
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
  const bar = el('bottom');
  const order = ['team', 'leads', 'account'] as const;
  /* Built once so the glass capsule can glide between tabs instead of being redrawn. */
  if (!bar.querySelector('.pill')) {
    bar.innerHTML =
      '<span class="pill" aria-hidden="true"></span>' +
      order.map((v) => '<button type="button" data-view="' + v + '">' + (v === 'account' ? ACCOUNT_ICON : ICON[v]) + '<span class="tl">' + (v === 'account' ? 'Account' : names[v]) + '</span></button>').join('');
    window.setTimeout(() => bar.classList.add('ready'), 150);
  }
  bar.style.setProperty('--i', String(order.indexOf(S.view as (typeof order)[number])));
  bar.querySelectorAll<HTMLElement>('button[data-view]').forEach((b) => {
    if (b.dataset['view'] === S.view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
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
    .map((c) => '<button type="button" data-cat="' + c + '" aria-pressed="' + (S.cat === c) + '">' + (c === 'all' ? 'All' : esc(catName(c))) + '</button>')
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
    .map((w) => '<span class="chip">' + esc(w.name) + '</span>');
  return names.length ? '<div class="chips">' + names.join('') + '</div>' : '<span class="muted">None yet</span>';
}

const MONTHS: readonly string[] = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dayKeyOf(y: number, m: number, d: number): string {
  return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

/** A month grid for choosing the day the Team numbers cover. Days after today cannot be picked. */
function calendarHtml(): string {
  const today = todayKey();
  const now = new Date();
  const lead = (new Date(S.dpY, S.dpM, 1).getDay() + 6) % 7;
  const days = new Date(S.dpY, S.dpM + 1, 0).getDate();
  const atEnd = S.dpY > now.getFullYear() || (S.dpY === now.getFullYear() && S.dpM >= now.getMonth());
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span></span>';
  for (let d = 1; d <= days; d++) {
    const key = dayKeyOf(S.dpY, S.dpM, d);
    cells += '<button type="button" class="dp-d' + (key === S.date && S.period === 'date' ? ' sel' : '') + (key === today ? ' now' : '') + '" data-dp-day="' + key + '"' + (key > today ? ' disabled' : '') + '>' + d + '</button>';
  }
  return (
    '<div class="dp dp-pop"><div class="dp-h"><button type="button" class="dp-nav" data-dp-nav="-1" aria-label="Previous month">&#8249;</button>' +
    '<b>' + MONTHS[S.dpM] + ' ' + S.dpY + '</b><button type="button" class="dp-nav" data-dp-nav="1" aria-label="Next month"' + (atEnd ? ' disabled' : '') + '>&#8250;</button></div>' +
    '<div class="dp-w"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><div class="dp-g">' + cells + '</div></div>'
  );
}

/** What the chosen period covers, in words: today's date, the week so far, the month's name, or the picked day. */
/** The period as the server wants it: the day too when a day, or an earlier week or month, was chosen. */
function periodParams(): string {
  return 'period=' + S.period + (S.date !== '' && S.period !== 'today' ? '&date=' + S.date : '');
}

function mondayOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
}

function periodNote(): string {
  const now = new Date();
  if (S.period === 'today') return fmtDay(todayKey());
  if (S.period === 'week') {
    const monday = mondayOf(S.date ? new Date(S.date + 'T12:00:00') : now);
    // The current week runs up to today; an earlier one is shown whole, Monday to Sunday.
    const end = S.date ? new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6) : now;
    return fmtDay(dayKeyOf(monday.getFullYear(), monday.getMonth(), monday.getDate()), false) + ' to ' + fmtDay(dayKeyOf(end.getFullYear(), end.getMonth(), end.getDate()), false);
  }
  if (S.period === 'month') {
    const shown = S.date ? new Date(S.date + 'T12:00:00') : now;
    return MONTHS[shown.getMonth()] + ' ' + shown.getFullYear();
  }
  return S.date ? fmtDay(S.date) : '';
}

function vTeam(): string {
  const people = data().people.filter(inCat);
  const showCat = S.cat === 'all';
  let h = head('Team', 'Who did what, and verifications, ' + sub());
  // The arrows step by the period: a day, a week or a month. They stop at the current one.
  const atNow = S.period === 'week' || S.period === 'month' ? S.date === '' : (S.period === 'date' ? S.date : todayKey()) === todayKey();
  const unit = S.period === 'week' ? 'week' : S.period === 'month' ? 'month' : 'day';
  h +=
    '<div class="perrow"><div class="seg per" role="group" aria-label="Period">' +
    PERIODS.map(([k, label]) => '<button type="button" data-period="' + k + '" aria-pressed="' + (S.period === k) + '">' + label + '</button>').join('') +
    '</div>' +
    '<div class="dpw">' +
    '<button type="button" class="dstep" data-dp-step="-1" aria-label="Previous ' + unit + '">&#8249;</button>' +
    '<button type="button" class="datepick' + (S.period === 'date' ? ' on' : '') + '" data-dp aria-expanded="' + S.dpOpen + '" aria-haspopup="dialog" aria-label="Pick a date" title="Pick a date">' + CAL + '<span>' + esc(periodNote()) + '</span></button>' +
    '<button type="button" class="dstep" data-dp-step="1" aria-label="Next ' + unit + '"' + (atNow ? ' disabled' : '') + '>&#8250;</button>' +
    (S.dpOpen ? calendarHtml() : '') +
    '</div></div>';
  h +=
    '<div class="tw cards team"><table><thead><tr><th style="width:1%;white-space:nowrap">Sr. no</th><th>Name</th>' + (showCat ? '<th>Category</th>' : '') + '<th>Services</th><th>Assigned</th><th>Contacted</th><th>Paid</th><th>Status</th></tr></thead><tbody>' +
    (people.length
      ? people
          .map((p, i) => {
            const state = !p.active ? 'Deactivated' : p.invited ? 'Invited' : 'Active';
            const won = p.stats.won;
            const closedTd = '<td data-label="Paid" data-l="closed"><div class="v-cell"><button type="button" class="btn sm v-review-btn" data-verify-user="' + p.id + '" data-verify-name="' + esc(p.name) + '" title="Verify paid deals" aria-label="Verify paid deals, ' + won + ' paid"><span class="num">' + won + '</span><span class="v-chip">' + SHIELD + '</span></button></div></td>';
            return (
              '<tr><td class="muted num" data-l="n">' + (i + 1) + '</td><td data-l="name"><span class="own static"><span class="av">' + esc(p.ini) + '</span><span>' + esc(p.name) + '</span></span></td>' + (showCat ? '<td data-l="cat">' + (p.category ? ct(p.category) : '') + '</td>' : '') + '<td data-label="Services" data-l="svc">' + chips(p) + '</td><td data-label="Assigned">' + num(p.stats.assigned) + '</td><td data-label="Contacted" data-l="leads"><button type="button" class="btn sm pl-btn" data-person-leads="' + p.id + '" data-person-name="' + esc(p.name) + '" title="View leads" aria-label="View ' + esc(p.name) + '\'s leads, ' + p.stats.contacted + ' contacted"><span class="num">' + p.stats.contacted + '</span><span class="v-chip">' + EYE + '</span></button></td>' + closedTd +
              '<td data-l="state"><span class="dotl' + (p.active && !p.invited ? '' : ' off') + '"><i></i>' + state + '</span></td></tr>'
            );
          })
          .join('')
      : '<tr><td colspan="' + (showCat ? 8 : 7) + '"><div class="empty"><b>No salespeople yet</b>They appear here once a superadmin invites them.</div></td></tr>') +
    '</tbody></table></div>';
  return h;
}

function stageName(s: string): string {
  return s === 'Didnt Pick' ? "Didn't Pick" : s === 'Won' ? 'Paid' : s;
}
function stageDot(s: string): string {
  const k = s === 'Won' ? 'won' : s === 'Lost' || s.startsWith('Invalid') ? 'off' : s === 'New' ? 'new' : 'mid';
  return '<span class="pl-stage ' + k + '">' + esc(stageName(s)) + '</span>';
}
function fmtWhen(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function fmtDay(key: string, weekday = true): string {
  return new Date(key + 'T12:00:00').toLocaleDateString('en-GB', weekday ? { day: 'numeric', month: 'short', weekday: 'short' } : { day: 'numeric', month: 'short' });
}
function todayKey(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function shortDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function loadPeopleFor(): void {
  const p = S.period;
  const day = S.date;
  api<ManagerBootstrap>('GET', '/api/manager/bootstrap?' + periodParams())
    .then((d) => {
      if (S.period !== p || S.date !== day) return;
      data().people = d.people;
      if (S.view === 'team') render();
    })
    .catch(fail);
}

function plCards(shown: PersonLead[]): string {
  return (
    shown
        .map((l, i) => {
          const open = S.openLead[l.id] === true;
          const path = l.history.length ? l.history.map((h) => esc(stageName(h.status)) + ' <small class="muted">' + shortDay(h.at) + '</small>').join(' → ') : 'New';
          const sub = [l.company, l.jobTitle].filter((x) => x).map(esc).join(' · ');
          return (
            '<div class="pl-card"><div class="pl-top"><span class="pl-n">' + (i + 1) + '</span><div class="pl-who"><b>' + esc(l.leadName) + '</b><span class="tag-chip">' + esc(l.workspaceName) + '</span>' +
            (sub ? '<div class="lead-sub">' + sub + '</div>' : '') + '</div>' + stageDot(l.status) + '</div>' +
            '<div class="pl-meta">' +
            (l.nextFollowUp ? '<span><i>Next follow-up</i> ' + esc(fmtDay(l.nextFollowUp)) + '</span>' : '') +
            '<span class="pl-path"><i>Journey</i> ' + path + '</span></div>' +
            (l.notes.length
              ? '<button type="button" class="pl-notes-btn" data-pl-toggle="' + l.id + '" aria-expanded="' + open + '">' + l.notes.length + (l.notes.length === 1 ? ' note' : ' notes') + (open ? ' ▴' : ' ▾') + '</button>' +
                (open ? '<ul class="pl-notes">' + l.notes.map((n) => '<li><div class="pl-nh">' + stageDot(n.stage) + '<small>' + fmtWhen(n.at) + '</small></div><div>' + esc(n.text) + '</div></li>').join('') + '</ul>' : '')
              : '<div class="muted pl-none">No notes</div>') +
            '</div>'
          );
        })
        .join('')
  );
}

function vPersonModal(): string {
  if (!S.leadsUser) return '';
  const u = S.leadsUser;
  const items = S.personLeads;
  let body: string;
  let summary = 'Loading...';
  if (!items) {
    body = '<div class="empty">Loading leads...</div>';
  } else if (items.length === 0) {
    summary = '0 leads';
    body = '<div class="empty"><b>No contacted leads</b>' + esc(u.name) + ' has not contacted any leads in this period.</div>';
  } else {
    const counts = new Map<string, number>();
    items.forEach((l) => counts.set(l.status, (counts.get(l.status) ?? 0) + 1));
    summary = items.length + (items.length === 1 ? ' lead' : ' leads') + ' · ' + [...counts.entries()].map(([s, n]) => n + ' ' + stageName(s)).join(' · ');
    const stage = counts.has(S.leadStage) ? S.leadStage : 'all';
    const shown = stage === 'all' ? items : items.filter((l) => l.status === stage);
    const chip = (key: string, label: string, n: number): string =>
      '<button type="button" class="pl-fbtn" data-pl-stage="' + esc(key) + '" aria-pressed="' + (stage === key) + '">' + esc(label) + '<small>' + n + '</small></button>';
    body =
      '<div class="pl-filter" role="group" aria-label="Filter by stage">' +
      chip('all', 'All', items.length) +
      [...counts.entries()].map(([s, n]) => chip(s, stageName(s), n)).join('') +
      '</div>' +
      '<div class="pl-list" id="pl-list">' + plCards(shown) +
      '</div>';
  }
  return (
    '<div class="backdrop" data-close-pl></div>' +
    '<div class="modal verify-modal pl-modal" role="dialog" aria-modal="true" aria-labelledby="pl-title">' +
    '<div class="modal-h"><div><h2 id="pl-title">Leads · ' + esc(u.name) + '</h2><span class="sub">' + esc(summary) + '</span></div>' +
    '<button type="button" class="modal-close-btn" data-close-pl aria-label="Close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4L4 12"/></svg></button></div>' +
    '<div class="modal-b pl-body">' + body + '</div>' +
    '<div class="modal-f"><button type="button" class="btn dark" data-close-pl>Done</button></div>' +
    '</div>'
  );
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
    body = '<div class="empty">Loading claimed paid leads...</div>';
  } else if (!items || items.length === 0) {
    body = '<div class="empty"><b>No paid claims found</b>' + esc(u.name) + ' has no claimed paid leads to verify this month.</div>';
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
        const isEditingStage = S.editingClaimId === item.id;
        const stageControl = isEditingStage
          ? '<div class="vm-stage-edit">' +
            '<select class="inp sm vm-stage-sel" data-stage-sel="' + item.id + '">' +
            ['Won', 'Meeting', 'Follow Up', 'Didnt Pick', 'Lost', 'Invalid Number', 'Invalid Email'].map((st) => '<option value="' + st + '"' + (st === item.status ? ' selected' : '') + '>' + (st === 'Didnt Pick' ? "Didn't Pick" : st === 'Won' ? 'Paid' : st) + '</option>').join('') +
            '</select>' +
            '<button type="button" class="btn sm dark" data-save-stage="' + item.id + '">Save</button>' +
            '<button type="button" class="btn sm" data-cancel-stage aria-label="Cancel">✕</button>' +
            '</div>'
          : '<button type="button" class="stage-pill-btn" data-toggle-stage="' + item.id + '">Stage: ' + esc(stageName(item.status)) + ' ▾</button>';

        return (
          '<tr class="' + rowClass + '" data-card-cid="' + item.id + '">' +
          '<td class="td-num">' + (i + 1) + '</td>' +
          '<td class="lead-col">' +
          '<div class="lead-name">' + esc(item.leadName) + '<span class="tag-chip">' + esc(item.workspaceName) + '</span></div>' +
          (item.leadPhone ? '<div class="lead-sub">' + esc(item.leadPhone) + '</div>' : '') +
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
    '<div><h2 id="vm-title">Verify Paid Claims · ' + esc(u.name) + '</h2>' +
    '<span class="sub">' + (items ? '<b class="c-true">' + verified + ' verified</b> · <span class="c-false">' + rejected + ' rejected</span> · <span class="c-pending">' + pending + ' pending</span> (Total: ' + total + ' claimed)' : 'Checking records...') + '</span>' +
    '</div>' +
    '<button type="button" class="modal-close-btn" data-close-verify aria-label="Close modal">' +
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4L4 12"/></svg>' +
    '</button>' +
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
  /* Nothing to page through, so no pager and no note. */
  if (res.total === 0) return h;
  const pages = Math.max(1, Math.ceil(res.total / res.pageSize));
  /* Numbered pages: the first, the last, and a few around the current one. */
  const shown = new Set<number>([1, pages, res.page - 1, res.page, res.page + 1]);
  const nums: string[] = [];
  let prev = 0;
  for (const p of [...shown].filter((x) => x >= 1 && x <= pages).sort((a, b) => a - b)) {
    if (p - prev > 1) nums.push('<span class="gap">…</span>');
    nums.push('<button type="button" class="btn sm pg" data-lgoto="' + p + '"' + (p === res.page ? ' aria-current="page"' : '') + '>' + p + '</button>');
    prev = p;
  }
  const from = res.total === 0 ? 0 : (res.page - 1) * res.pageSize + 1;
  const to = Math.min(res.total, res.page * res.pageSize);
  h +=
    '<div class="pager"><span class="pg-info">' + from + '–' + to + ' of ' + res.total.toLocaleString('en-IN') + ' leads</span><span class="pg-btns"><button type="button" class="btn sm" data-lpage="-1"' + (res.page <= 1 ? ' disabled' : '') + ' aria-label="Previous page">‹</button>' +
    nums.join('') + '<button type="button" class="btn sm" data-lpage="1"' + (res.page >= pages ? ' disabled' : '') + ' aria-label="Next page">›</button></span></div>';
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
    '<p class="hint">You can look at the team and every lead in ' + esc(seeing) + '. Managers can also review and verify paid leads.</p>' +
    '<button type="button" class="btn dark acct-out" data-signout>Sign out</button>'
  );
}

/* Switching sections: each block drops in from above, one after another, as on the leads page. */
const SHOWER = '.head,.sb,.acct,.hint,.pager,.acct-out,tbody tr,.empty';
function shower(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const els = el('view').querySelectorAll<HTMLElement>(SHOWER);
  const vh = window.innerHeight;
  for (let i = 0, n = 0; i < els.length; i++) {
    const node = els[i];
    if (!node || node.closest('.verify-modal')) continue;
    if (node.getBoundingClientRect().top > vh) continue;
    node.style.animation = 'v-fall .75s cubic-bezier(.22,.8,.3,1) ' + Math.min(n, 18) * 60 + 'ms backwards';
    n++;
  }
}
let barLock = 0;
function settleBar(): void {
  barLock = Date.now() + 700;
  el('bottom').classList.remove('min');
}

function render(keepFocus?: boolean, animate?: boolean): void {
  nav();
  const view = el('view');
  const focused = keepFocus && document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
  const caret = focused ? focused.selectionStart : null;
  view.innerHTML = (S.view === 'account' ? vAccount() : (S.view === 'team' ? vTeam() : vLeads())) + vVerifyModal() + vPersonModal();
  if (focused) {
    const input = document.getElementById('lq');
    if (input instanceof HTMLInputElement) {
      input.focus();
      if (caret !== null) input.setSelectionRange(caret, caret);
    }
  }
  if (animate) {
    window.scrollTo(0, 0);
    settleBar();
    shower();
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
      if (S.view === 'leads') render(keepFocus, !keepFocus && page === 1 && S.leadsFresh);
      S.leadsFresh = false;
    })
    .catch(fail);
}

function openPersonLeads(id: string, name: string): void {
  S.leadsUser = { id, name };
  S.personLeads = null;
  S.leadStage = 'all';
  S.openLead = {};
  render();
  api<PersonLeads>('GET', '/api/manager/people/' + encodeURIComponent(id) + '/leads?' + periodParams())
    .then((res) => {
      if (S.leadsUser?.id !== id) return;
      S.personLeads = res.leads;
      render();
    })
    .catch((e: unknown) => {
      S.leadsUser = null;
      fail(e);
      render();
    });
}

function openVerificationModal(userId: string, name: string): void {
  S.verifyUser = { id: userId, name };
  S.loadingVerifications = true;
  S.verifications = null;
  S.editingClaimId = null;
  render();
  api<VerificationItem[]>('GET', '/api/manager/verifications?userId=' + encodeURIComponent(userId) + '&' + periodParams())
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.dpOpen) {
    S.dpOpen = false;
    render();
  }
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

  // A click anywhere else closes the calendar, and the click then does whatever it was meant to.
  if (S.dpOpen && !hit('.dpw')) {
    S.dpOpen = false;
    render();
  }
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
    const changed = S.view !== v;
    S.view = v;
    S.leadsFresh = v === 'leads' && !S.leads;
    if (v === 'leads' && !S.leads) loadLeads();
    render(false, changed && !S.leadsFresh);
    return;
  }
  if ((c = hit('[data-cat]'))) {
    const next = c.dataset['cat'];
    if (next !== 'all' && !isCategory(next)) return;
    S.cat = next;
    S.page = 1;
    S.leads = null;
    S.leadsFresh = S.view === 'leads';
    render(false, S.view !== 'leads');
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
  if ((c = hit('[data-lgoto]'))) {
    S.page = Math.max(1, Number(c.dataset['lgoto']) || 1);
    loadLeads();
    window.scrollTo(0, 0);
    return;
  }
  if ((c = hit('[data-lpage]'))) {
    const step = Number(c.dataset['lpage']);
    S.page = Math.max(1, S.page + (step < 0 ? -1 : 1));
    loadLeads();
    window.scrollTo(0, 0);
    return;
  }

  if ((c = hit('[data-period]'))) {
    const p = c.dataset['period'];
    if ((p !== 'today' && p !== 'week' && p !== 'month') || (p === S.period && S.date === '')) return;
    S.period = p;
    S.date = '';
    render();
    loadPeopleFor();
    return;
  }
  if (hit('[data-dp]')) {
    if (!S.dpOpen) {
      const shown = S.period === 'date' && S.date ? new Date(S.date + 'T12:00:00') : new Date();
      S.dpY = shown.getFullYear();
      S.dpM = shown.getMonth();
    }
    S.dpOpen = !S.dpOpen;
    render();
    return;
  }
  if ((c = hit('[data-dp-step]'))) {
    const dir = Number(c.dataset['dpStep']);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const from = S.date ? new Date(S.date + 'T12:00:00') : today;
    if (S.period === 'week' || S.period === 'month') {
      const monday = mondayOf(from);
      const next = S.period === 'week' ? new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7 * dir) : new Date(from.getFullYear(), from.getMonth() + dir, 1);
      const nowStart = S.period === 'week' ? mondayOf(today) : new Date(today.getFullYear(), today.getMonth(), 1);
      if (next.getTime() > nowStart.getTime()) return;
      S.date = next.getTime() === nowStart.getTime() ? '' : dayKeyOf(next.getFullYear(), next.getMonth(), next.getDate());
    } else {
      from.setDate(from.getDate() + dir);
      const key = dayKeyOf(from.getFullYear(), from.getMonth(), from.getDate());
      if (key > todayKey()) return;
      S.period = key === todayKey() ? 'today' : 'date';
      S.date = key === todayKey() ? '' : key;
    }
    S.dpOpen = false;
    render();
    loadPeopleFor();
    return;
  }
  if ((c = hit('[data-dp-nav]'))) {
    const to = new Date(S.dpY, S.dpM + Number(c.dataset['dpNav']), 1);
    S.dpY = to.getFullYear();
    S.dpM = to.getMonth();
    render();
    return;
  }
  if ((c = hit('[data-dp-day]'))) {
    const key = c.dataset['dpDay'];
    if (!key || key > todayKey()) return;
    S.period = 'date';
    S.date = key;
    S.dpOpen = false;
    render();
    loadPeopleFor();
    return;
  }
  if ((c = hit('[data-person-leads]'))) {
    const pid = c.dataset['personLeads'];
    if (pid) openPersonLeads(pid, c.dataset['personName'] || 'Salesperson');
    return;
  }
  if (hit('[data-close-pl]')) {
    S.leadsUser = null;
    S.personLeads = null;
    render();
    return;
  }
  if ((c = hit('[data-pl-stage]'))) {
    S.leadStage = c.dataset['plStage'] || 'all';
    const all = S.personLeads ?? [];
    const list = document.getElementById('pl-list');
    if (!list) return;
    // Only the list changes, so the popup keeps its size and the chips don't flicker; the cards drop in one after another.
    document.querySelectorAll<HTMLElement>('[data-pl-stage]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset['plStage'] === S.leadStage)));
    list.innerHTML = plCards(S.leadStage === 'all' ? all : all.filter((l) => l.status === S.leadStage));
    const body = document.querySelector('.pl-body');
    if (body) body.scrollTop = 0;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      list.querySelectorAll<HTMLElement>('.pl-card').forEach((card, i) => {
        card.style.animation = 'v-fall .75s cubic-bezier(.22,.8,.3,1) ' + Math.min(i, 12) * 60 + 'ms backwards';
      });
    }
    return;
  }
  if ((c = hit('[data-pl-toggle]'))) {
    const id = c.dataset['plToggle'];
    if (id) {
      const top = document.querySelector('.pl-body')?.scrollTop ?? 0;
      S.openLead[id] = !S.openLead[id];
      render();
      const again = document.querySelector('.pl-body');
      if (again) again.scrollTop = top;
    }
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

/* Phone bottom bar: shrinks to icons after a real scroll down, expands on scroll up; ignores bounce and section changes. */
{
  let lastY = 0;
  let acc = 0;
  let lastFlip = 0;
  const bar = el('bottom');
  window.addEventListener(
    'scroll',
    () => {
      const now = Date.now();
      const y = window.scrollY || 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (now < barLock || y < 0 || y > max) {
        lastY = Math.max(0, Math.min(y, max));
        acc = 0;
        return;
      }
      const d = y - lastY;
      lastY = y;
      if (d * acc < 0) acc = 0;
      acc += d;
      const isMin = bar.classList.contains('min');
      if (!isMin && acc > 48 && y > 140 && now - lastFlip > 450) {
        bar.classList.add('min');
        lastFlip = now;
        acc = 0;
      } else if (isMin && ((acc < -32 && now - lastFlip > 450) || y < 60)) {
        bar.classList.remove('min');
        lastFlip = now;
        acc = 0;
      }
    },
    { passive: true },
  );
}

const embedded = takeEmbedded<ManagerBootstrap>();
(embedded ? Promise.resolve(embedded) : api<ManagerBootstrap>('GET', '/api/manager/bootstrap'))
  .then((d) => {
    D = d;
    render(false, true);
  })
  .catch((e: unknown) => {
    el('view').innerHTML = '<div class="empty"><b>Could not load</b>' + esc(messageOf(e)) + '</div>';
  });

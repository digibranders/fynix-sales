/** Shapes of the data the sales page sends and receives (see src/routes/sales.ts and src/domain.ts). */

export interface Me {
  id: string;
  name: string;
  ini: string;
  email: string;
  category: string;
}

export interface Workspace {
  id: string;
  key: string;
  name: string;
  icon: string;
  color: string;
}

export interface HistoryEntry {
  s: string;
  t: number;
}

export interface ClaimComment {
  id: number;
  by: string;
  at: number;
  text: string;
  stage: string;
  edited: boolean;
}

/** One person's claim on a lead in one service. `next` is a YYYY-MM-DD key, or '' when there is none. */
export interface Claim {
  id: string;
  owner: string;
  status: string;
  history: HistoryEntry[];
  next: string;
  last: number;
  comments: ClaimComment[];
  verified?: number;
  verifiedAt?: number | null;
  verifiedBy?: string | null;
  verificationNote?: string | null;
}

/** A lead as the server sends it. */
export interface ServerLead {
  id: string;
  pid: string;
  name: string;
  cat: string;
  area: string;
  city: string;
  addr: string;
  phone: string;
  web: string;
  email: string[];
  wa: string;
  hrs: string[] | string;
  company: string;
  title: string;
  personalNumber: string;
  keywords: string;
  linkedin: string;
  country: string;
  state: string;
  social: string[];
  open: string[];
  work: Record<string, Claim>;
}

/** A lead after the page has matched its category to an industry group (-1 when there is no match). */
export interface Lead extends ServerLead {
  grp: number;
}

export interface Notice {
  id: string;
  kind: string;
  title: string;
  sub: string;
  svc: string;
  tab: string;
  at: number;
}

export interface Bootstrap {
  me: Me;
  category: string;
  workspaces: Workspace[];
  leads: ServerLead[];
  notices: Notice[];
  reads: string[];
  targets: Record<string, number>;
}

/** Google Business categories: [name, industry group index, worldwide businesses]. */
export type GbcCategory = [string, number, number];
export interface GbcData {
  groups: string[];
  cats: GbcCategory[];
}

export interface ReportTotals {
  assigned: number;
  contacted: number;
  interested: number;
  meetings: number;
  negotiation: number;
  won: number;
  lost: number;
  openNow: number;
}
export interface ReportService extends ReportTotals {
  service: string;
}
export interface ReportMonth extends ReportTotals {
  month: string;
  label: string;
}
export interface Report {
  month: string;
  label: string;
  services: ReportService[];
  totals: ReportTotals;
  history: ReportMonth[];
}

/** A service as the page shows it: name, tile colours and the icon's SVG markup. */
export interface Service {
  id: string;
  name: string;
  t1: string;
  t2: string;
  icon: string;
}

export type Tab = 'info' | 'assigned' | 'kpi' | 'profile';
export type KpiPeriod = 'today' | '7d' | 'month';
/** The three filter dropdowns. */
export type DdId = 'area' | 'grp' | 'cat';

export interface AppState {
  user: string;
  service: string;
  tab: Tab;
  q: string;
  area: string;
  grp: number | '';
  cat: string;
  need: string[];
  /** Which dropdown or popup is open ('' for none). */
  open: string;
  sort: string;
  page: number;
  selected: string | null;
  showDetail: boolean;
  stageFilter: string;
  logStage: string;
  stgOpen: Record<string, boolean>;
  stgLead: string;
  calMonth: string;
  qf: string;
  closedOpen: boolean;
  kpiPeriod: KpiPeriod;
  read: Record<string, boolean>;
  /** Which modal is showing: a lead id, or the name of a sheet. */
  modal: string | null;
}

export interface FilterDrawerState {
  open: boolean;
  sec: DdId | '';
  q: string;
  needOpen: boolean;
}

export interface DdItem {
  v: string;
  l: string;
  sub: string;
  n: number;
  w: number;
  zero: boolean;
}

export interface NoticeItem {
  id: string;
  kind: string;
  rank: number;
  late: number;
  title: string;
  sub: string;
  tag: string;
  svc: string;
  lead?: string;
  tab?: string;
  unread: boolean;
}

export interface QueueGroup {
  key: string;
  title: string;
  items: Lead[];
}

export interface ActivityNote {
  id: number;
  text: string;
  t: number;
  edited: boolean;
}
export interface ActivityItem {
  stage: string;
  t: number;
  i: number;
  notes: ActivityNote[];
}

export interface OwnNote {
  lead: Lead;
  svc: string;
  stage: string;
  text: string;
  at: number;
}

export interface FoundNote {
  lead: Lead;
  svc: string;
  note: ClaimComment;
}

export interface Targets {
  contacted: number;
  meetings: number;
  won: number;
}

export interface TileSpec {
  t1: string;
  t2: string;
  g: string;
}

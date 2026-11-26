/** The two sales categories. A person, list or service belongs to exactly one. */
export type Category = 'scale' | 'reach';
/** The category switch in the sidebar. */
export type CategoryFilter = Category | 'all';
/** The category choice when adding a service, which can also create it in both. */
export type FormCat = Category | 'both';
export type Metric = 'contacted' | 'meetings' | 'won';
export type Role = 'sales' | 'manager' | 'superadmin';
export type View = 'overview' | 'workspaces' | 'lists' | 'leads' | 'team' | 'reports' | 'notify';

export interface CategoryInfo {
  name: string;
  sub: string;
}

export interface Workspace {
  id: string;
  category: Category;
  key: string;
  name: string;
  icon: string;
  color: string;
  leadCount: number;
  claimedCount: number;
  listIds: string[];
  memberIds: string[];
}

export interface LeadList {
  id: string;
  name: string;
  category: Category;
  fileName: string;
  createdAt: number;
  archived: boolean;
  leadCount: number;
  /** How many of this data's leads are assigned to salespeople right now. */
  assignedCount: number;
  workspaceIds: string[];
}

export interface PersonStats {
  assigned: number;
  contacted: number;
  meetings: number;
  won: number;
  verifiedWon?: number;
}

/** One client who paid with a salesperson's coupon (a client who paid more than once is one row per currency). */
export interface PayingClient {
  businessId: string;
  name: string;
  email: string;
  code: string;
  amountCents: number;
  currency: string;
  paidAt: number;
}

export interface PersonCoupons {
  codes: string[];
  clients: PayingClient[];
}

export interface CouponCreateBody {
  code: string;
  userId: string;
  currency: string;
  discountKind: 'percent' | 'amount';
  discountValue: number;
  discountMonths?: number;
  expiresAt?: string;
  maxRedemptions?: number;
  note?: string;
}

export interface CouponForm {
  code: string;
  kind: 'percent' | 'amount';
  value: string;
  months: string;
  expiry: string;
  /** Whether the date picker is open, and the month it shows. */
  calOpen: boolean;
  /** Which dropdown in the coupon form is open. */
  dd: '' | 'user' | 'kind';
  calY: number;
  calM: number;
  max: string;
  note: string;
}

export interface Person {
  id: string;
  name: string;
  ini: string;
  email: string;
  role: Role;
  category: Category | null;
  active: boolean;
  invited: boolean;
  workspaceIds: string[];
  stats: PersonStats;
  coupons: PersonCoupons;
}

export interface Activity {
  id: number;
  at: number;
  category: Category | null;
  text: string;
  sub: string;
}

export type Targets = Record<Metric, number>;

/** GET /api/admin/bootstrap */
/** Who a notification is for. */
export type Audience = Category | 'both';

/** A notification a superadmin sent to salespeople. */
export interface Announcement {
  id: string;
  audience: Audience;
  subject: string;
  body: string;
  at: number;
  by: string;
  /** How many active salespeople it reaches. */
  reach: number;
}

export interface NotifyForm {
  audience: Audience;
  subject: string;
  body: string;
  busy: boolean;
  error: string;
  /** The notification whose Remove button was pressed and is waiting for a second click. */
  confirm: string | null;
}

export interface Bootstrap {
  me: { id: string; name: string; ini: string; email: string };
  categories: Record<Category, CategoryInfo>;
  workspaces: Workspace[];
  lists: LeadList[];
  people: Person[];
  activity: Activity[];
  announcements: Announcement[];
  targets: Partial<Record<Category, Targets>>;
}

export interface LeadOwner {
  id: string;
  name: string;
}

export interface LeadRow {
  id: string;
  name: string;
  area: string;
  city: string;
  company: string;
  jobTitle: string;
  personalNumber: string;
  keywords: string;
  linkedin: string;
  phone: string;
  website: string;
  listId: string;
  category: Category;
  owners: Record<string, LeadOwner | undefined>;
}

/** GET /api/admin/leads */
export interface LeadsPage {
  total: number;
  page: number;
  pageSize: number;
  leads: LeadRow[];
}

/** POST /api/admin/lists */
export interface ListImportResult {
  id: string;
  added: number;
  duplicates: number;
}

/** POST /api/admin/users */
export interface UserCreateResult {
  id: string;
  canEmail: boolean;
  inviteUrl: string;
  expiresAt: number;
}

/** POST /api/admin/users/:id/invite */
export interface InviteResult {
  canEmail: boolean;
  inviteUrl: string;
  expiresAt: number;
  reset: boolean;
}

export interface WorkspaceCreateBody {
  name: string;
  category: FormCat;
  listIds: string[];
  memberIds: string[];
}

export interface ListCreateBody {
  name: string;
  category: Category;
  fileName: string;
  csv: string;
  /** An Excel file, base64 encoded, sent in place of csv. */
  xlsx?: string;
  workspaceIds: string[];
}

export interface UserCreateBody {
  name: string;
  email: string;
  role: Role;
  workspaceIds: string[];
  category?: Category;
}

export interface TargetsBody {
  category: Category;
  contacted: number;
  won: number;
}

/** A row in a tick list: an id and the label shown. */
export interface PickItem {
  id: string;
  name: string;
}

/** Details for the invite-link dialog. */
export interface LinkInfo {
  title: string;
  body: string;
  link: string;
  name: string;
  /** Who the link is for, so it can be emailed on request. */
  userId: string;
  email: string;
  /** False until a mail provider is set up on the server. */
  canEmail: boolean;
}

export type ModalKind = 'ws' | 'list' | 'person' | 'editpeople' | 'rename' | 'category' | 'link' | 'coupon' | 'clients';

/** Everything the open dialog edits. Fields a dialog does not use stay at their defaults. */
export interface ModalForm extends LinkInfo {
  error: string;
  busy: boolean;
  id: string;
  /** The invite link was emailed from this dialog. */
  sent: boolean;
  role: Role;
  cat: FormCat;
  members: string[];
  lists: string[];
  wss: string[];
  csv: string;
  /** The chosen Excel file, base64 encoded. */
  xlsx: string;
  fileName: string;
  coupon: CouponForm;
}

/** The service drawer's unsaved choices. */
export interface DrawerForm {
  id: string;
  lists: string[];
  members: string[];
  confirm: boolean;
  error: string;
}

export interface LeadsState {
  q: string;
  page: number;
  res: LeadsPage | null;
  loading: boolean;
}

export interface PageState {
  report: { y: number; m: number };
  view: View;
  cat: CategoryFilter;
  modal: ModalKind | null;
  form: { m: ModalForm | null; drawer: DrawerForm | null };
  leads: LeadsState;
  drawerId: string | null;
  listConfirm: string | null;
  /** The person whose Delete button was pressed and is waiting for a second click. */
  userConfirm: string | null;
  notify: NotifyForm;
}

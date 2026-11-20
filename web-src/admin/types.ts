/** The two sales categories. A person, list or service belongs to exactly one. */
export type Category = 'scale' | 'reach';
/** The category switch in the sidebar. */
export type CategoryFilter = Category | 'all';
/** The category choice when adding a service, which can also create it in both. */
export type FormCat = Category | 'both';
export type Metric = 'contacted' | 'meetings' | 'won';
export type Role = 'sales' | 'superadmin';
export type View = 'overview' | 'workspaces' | 'lists' | 'leads' | 'team' | 'reports';

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
  workspaceIds: string[];
}

export interface PersonStats {
  assigned: number;
  contacted: number;
  meetings: number;
  won: number;
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
export interface Bootstrap {
  me: { id: string; name: string; ini: string; email: string };
  categories: Record<Category, CategoryInfo>;
  workspaces: Workspace[];
  lists: LeadList[];
  people: Person[];
  activity: Activity[];
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
  emailed: boolean;
  inviteUrl: string;
  expiresAt: number;
}

/** POST /api/admin/users/:id/invite */
export interface InviteResult {
  emailed: boolean;
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
}

export type ModalKind = 'ws' | 'list' | 'person' | 'editpeople' | 'link';

/** Everything the open dialog edits. Fields a dialog does not use stay at their defaults. */
export interface ModalForm extends LinkInfo {
  error: string;
  busy: boolean;
  id: string;
  email: string;
  role: Role;
  cat: FormCat;
  members: string[];
  lists: string[];
  wss: string[];
  csv: string;
  fileName: string;
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
}

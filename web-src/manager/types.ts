import type { Category, LeadsPage, PersonCoupons, PersonStats, Workspace } from '../admin/types.js';

export type { Category, LeadsPage, Workspace };

/** A salesperson as a manager sees them: no email address. */
export interface TeamMember {
  id: string;
  name: string;
  ini: string;
  category: Category | null;
  active: boolean;
  invited: boolean;
  workspaceIds: string[];
  stats: PersonStats;
  coupons: PersonCoupons;
}

/** GET /api/manager/bootstrap */
export type Period = 'today' | 'week' | 'month' | 'date';

export interface ManagerBootstrap {
  period?: Period;
  me: { id: string; name: string; ini: string; email: string };
  /** Only the categories this manager may look at. */
  categories: Partial<Record<Category, { name: string; sub: string }>>;
  workspaces: Workspace[];
  people: TeamMember[];
}

export interface VerificationItem {
  id: string;
  leadId: string;
  workspaceId: string;
  ownerId: string;
  status: string;
  verified: number;
  verifiedAt: number | null;
  verifiedBy: string | null;
  verificationNote: string | null;
  leadName: string;
  leadArea: string;
  leadCity: string;
  leadCompany: string;
  leadJobTitle: string;
  leadPhone: string;
  workspaceName: string;
  workspaceCategory: Category;
  ownerName: string;
  closedAt: number;
  latestNote: string | null;
}

export interface PersonLead {
  id: string;
  leadName: string;
  company: string;
  jobTitle: string;
  area: string;
  phone: string;
  workspaceName: string;
  category: Category;
  status: string;
  nextFollowUp: string | null;
  lastActivityAt: number;
  history: { status: string; at: number }[];
  notes: { id: number; stage: string; text: string; at: number }[];
}

/** GET /api/manager/people/:id/leads */
export interface PersonLeads {
  person: { id: string; name: string };
  leads: PersonLead[];
}

export type ManagerView = 'team' | 'leads' | 'account';

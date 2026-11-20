import type { Category, LeadsPage, PersonStats, Workspace } from '../admin/types.js';

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
}

/** GET /api/manager/bootstrap */
export interface ManagerBootstrap {
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

export type ManagerView = 'team' | 'leads' | 'account';

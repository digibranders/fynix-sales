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

export type ManagerView = 'team' | 'leads' | 'account';

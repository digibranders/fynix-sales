import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../app.js';
import type { SessionUser } from '../auth.js';
import { CATEGORIES, all } from '../db.js';
import type { Category } from '../db.js';
import { CATEGORY_INFO, HttpError, initials } from '../domain.js';
import { leadsQuery, loadLeads, loadPeople } from './admin.js';

interface WorkspaceRow {
  id: string;
  category: Category;
  key: string;
  name: string;
  icon: string;
  color: string;
}

/** The signed-in manager and the categories they may look at: one, or both when none was chosen. */
function manager(request: FastifyRequest): { user: SessionUser; scope: Category[] } {
  const user = request.user;
  if (!user) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
  if (user.role !== 'manager') throw new HttpError(403, 'forbidden', 'This area is for managers.');
  if (user.mustChangePassword) throw new HttpError(403, 'password_change_required', 'Change your password first.');
  return { user, scope: user.category ? [user.category] : [...CATEGORIES] };
}

/** Read-only views for managers: the sales team and every lead in their categories. Nothing here changes data. */
export function registerManagerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/manager/bootstrap', async (request) => {
    const { user, scope } = manager(request);
    const workspaces = (await all<WorkspaceRow>(db, 'SELECT id, category, key, name, icon, color FROM workspaces ORDER BY category, position, name')).filter((w) =>
      scope.includes(w.category),
    );
    const people = await loadPeople(db, scope);
    return {
      me: { id: user.id, name: user.name, ini: initials(user.name), email: user.email },
      categories: Object.fromEntries(scope.map((c) => [c, CATEGORY_INFO[c]])),
      workspaces,
      people: people.map(({ email: _email, ...rest }) => rest),
    };
  });

  app.get('/api/manager/leads', async (request) => {
    const { scope } = manager(request);
    return loadLeads(db, leadsQuery.parse(request.query), scope);
  });
}

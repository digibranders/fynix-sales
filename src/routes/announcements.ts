import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { loadAnnouncements } from '../announcements.js';
import { newId, one, run } from '../db.js';
import { HttpError, logActivity } from '../domain.js';
import { superadmin } from './admin.js';

const announcementBody = z.object({
  audience: z.enum(['scale', 'reach', 'both']),
  subject: z.string().trim().min(1, 'Write a subject.').max(120, 'Keep the subject under 120 characters.'),
  body: z.string().trim().min(1, 'Write the message.').max(2000, 'Keep the message under 2000 characters.'),
});

const AUDIENCE_NAME = { scale: 'Scale', reach: 'Reach', both: 'Scale and Reach' } as const;

export function registerAnnouncementRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/admin/announcements', async (request) => {
    superadmin(request);
    return { announcements: await loadAnnouncements(db) };
  });

  app.post('/api/admin/announcements', async (request, reply) => {
    const me = superadmin(request);
    const body = announcementBody.parse(request.body);
    const id = newId();
    await run(db, 'INSERT INTO announcements (id, audience, subject, body, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, body.audience, body.subject, body.body, me.id, Date.now()]);
    await logActivity(db, body.audience === 'both' ? null : body.audience, `${me.name} sent a notification: ${body.subject}`, AUDIENCE_NAME[body.audience]);
    return reply.status(201).send({ id });
  });

  /** Taking one back removes it from every salesperson's notifications. */
  app.delete<{ Params: { id: string } }>('/api/admin/announcements/:id', async (request) => {
    const me = superadmin(request);
    const found = await one<{ subject: string; audience: 'scale' | 'reach' | 'both' }>(db, 'SELECT subject, audience FROM announcements WHERE id = ?', [request.params.id]);
    if (!found) throw new HttpError(404, 'not_found', 'That notification does not exist.');
    await run(db, 'DELETE FROM announcements WHERE id = ?', [request.params.id]);
    await run(db, 'DELETE FROM notification_reads WHERE key = ?', [`a:${request.params.id}`]);
    await logActivity(db, found.audience === 'both' ? null : found.audience, `${me.name} took back the notification: ${found.subject}`, AUDIENCE_NAME[found.audience]);
    return { ok: true };
  });
}

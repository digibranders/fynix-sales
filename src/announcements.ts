import type { Db } from './db.js';
import { all } from './db.js';

export interface SentAnnouncement {
  id: string;
  audience: 'scale' | 'reach' | 'both';
  subject: string;
  body: string;
  at: number;
  by: string;
  /** How many active salespeople it reaches. */
  reach: number;
}

/** What was sent, newest first, with how many active salespeople each one reaches. */
export async function loadAnnouncements(db: Db): Promise<SentAnnouncement[]> {
  const rows = await all<{ id: string; audience: 'scale' | 'reach' | 'both'; subject: string; body: string; created_at: number; by_name: string | null; reach: number }>(
    db,
    `SELECT a.id, a.audience, a.subject, a.body, a.created_at, u.name AS by_name,
            (SELECT COUNT(*) FROM users s WHERE s.role = 'sales' AND s.active = 1 AND (a.audience = 'both' OR s.category = a.audience)) AS reach
       FROM announcements a LEFT JOIN users u ON u.id = a.created_by
      ORDER BY a.created_at DESC LIMIT 100`,
  );
  return rows.map((r) => ({ id: r.id, audience: r.audience, subject: r.subject, body: r.body, at: Number(r.created_at), by: r.by_name ?? '', reach: Number(r.reach) }));
}

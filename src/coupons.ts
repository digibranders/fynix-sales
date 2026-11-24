import type { Db } from './db.js';
import { all, inClause } from './db.js';

export interface PayingClient {
  businessId: string;
  name: string;
  email: string;
  code: string;
  /** What this client has paid through the salesperson's coupons, in minor units (paise, cents). */
  amountCents: number;
  currency: string;
  /** When they last paid, in milliseconds. */
  paidAt: number;
}

export interface PersonCoupons {
  codes: string[];
  clients: PayingClient[];
}

/**
 * Each salesperson's coupon codes and the distinct clients who paid with them between `since` and `until`.
 * A client who paid several times is one row per currency, with the total and the latest payment date.
 */
export async function loadPersonCoupons(db: Db, userIds: string[], since: number, until: number): Promise<Map<string, PersonCoupons>> {
  const result = new Map<string, PersonCoupons>();
  if (userIds.length === 0) return result;
  for (const id of userIds) result.set(id, { codes: [], clients: [] });
  for (const row of await all<{ user_id: string; code: string }>(db, `SELECT user_id, code FROM coupons WHERE user_id IN (${inClause(userIds)}) ORDER BY created_at, code`, userIds)) {
    result.get(row.user_id)?.codes.push(row.code);
  }
  const rows = await all<{
    user_id: string;
    business_id: string;
    name: string;
    email: string;
    code: string;
    amount: number;
    currency: string;
    paid_at: number;
  }>(
    db,
    `SELECT c.user_id, p.business_id, (ARRAY_AGG(p.client_name ORDER BY p.paid_at DESC))[1] AS name,
            (ARRAY_AGG(p.client_email ORDER BY p.paid_at DESC))[1] AS email,
            (ARRAY_AGG(c.code ORDER BY p.paid_at DESC))[1] AS code,
            SUM(p.amount_cents) AS amount, p.currency, MAX(p.paid_at) AS paid_at
       FROM coupon_payments p JOIN coupons c ON c.id = p.coupon_id
      WHERE c.user_id IN (${inClause(userIds)}) AND p.paid_at >= ? AND p.paid_at < ?
      GROUP BY c.user_id, p.business_id, p.currency
      ORDER BY MAX(p.paid_at) DESC`,
    [...userIds, since, until],
  );
  for (const r of rows) {
    result.get(r.user_id)?.clients.push({ businessId: r.business_id, name: r.name, email: r.email, code: r.code, amountCents: r.amount, currency: r.currency, paidAt: r.paid_at });
  }
  return result;
}

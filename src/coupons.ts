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

export interface OwnCoupon {
  code: string;
  currency: string;
  discountKind: 'percent' | 'amount';
  discountValue: string;
  /** How many months the discount lasts, or null when it is not limited. */
  discountMonths: number | null;
  expiresAt: string | null;
  maxRedemptions: number | null;
  /** The superadmin's note for the salesperson, or an empty string. */
  note: string;
  createdAt: number;
  /** The clients who paid with this code, newest payment first (one row per client and currency). */
  clients: PayingClient[];
}

/** One salesperson's own coupon codes, newest first, each with the clients who paid with it (all time). */
export async function loadOwnCoupons(db: Db, userId: string): Promise<OwnCoupon[]> {
  const coupons = await all<{
    id: string;
    code: string;
    currency: string;
    discount_kind: string;
    discount_value: string;
    discount_months: number | null;
    expires_at: string | null;
    max_redemptions: number | null;
    note: string | null;
    created_at: number;
  }>(db, 'SELECT id, code, currency, discount_kind, discount_value, discount_months, expires_at, max_redemptions, note, created_at FROM coupons WHERE user_id = ? ORDER BY created_at DESC, code', [userId]);
  if (coupons.length === 0) return [];
  const paid = await all<{ coupon_id: string; business_id: string; name: string; email: string; amount: number; currency: string; paid_at: number }>(
    db,
    `SELECT p.coupon_id, p.business_id, (ARRAY_AGG(p.client_name ORDER BY p.paid_at DESC))[1] AS name,
            (ARRAY_AGG(p.client_email ORDER BY p.paid_at DESC))[1] AS email,
            SUM(p.amount_cents) AS amount, p.currency, MAX(p.paid_at) AS paid_at
       FROM coupon_payments p
      WHERE p.coupon_id IN (${inClause(coupons.map((c) => c.id))})
      GROUP BY p.coupon_id, p.business_id, p.currency
      ORDER BY MAX(p.paid_at) DESC`,
    coupons.map((c) => c.id),
  );
  return coupons.map((c) => ({
    code: c.code,
    currency: c.currency,
    discountKind: c.discount_kind === 'amount' ? 'amount' : 'percent',
    discountValue: c.discount_value,
    discountMonths: c.discount_months,
    expiresAt: c.expires_at,
    maxRedemptions: c.max_redemptions,
    note: c.note ?? '',
    createdAt: Number(c.created_at),
    clients: paid
      .filter((p) => p.coupon_id === c.id)
      .map((p) => ({ businessId: p.business_id, name: p.name, email: p.email, code: c.code, amountCents: Number(p.amount), currency: p.currency, paidAt: Number(p.paid_at) })),
  }));
}

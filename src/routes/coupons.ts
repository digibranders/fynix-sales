import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { all, newId, one, run } from '../db.js';
import { HttpError, logActivity } from '../domain.js';
import { superadmin } from './admin.js';

const FIVE_MINUTES = 5 * 60_000;

const couponCreate = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,32}$/, 'Use 3 to 32 letters, numbers, dashes or underscores for the code.'),
    userId: z.string().min(1, 'Choose a salesperson.').max(64),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a three-letter currency such as INR.').default('INR'),
    discountKind: z.enum(['percent', 'amount']),
    discountValue: z.coerce.number().positive('Enter a discount greater than zero.').max(10_000_000),
    discountMonths: z.number().int().min(1).max(120).optional(),
    expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick an expiry date.').optional(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).optional(),
    note: z.string().trim().max(500, 'Keep the note under 500 characters.').optional(),
  })
  .refine((v) => v.discountKind !== 'percent' || v.discountValue <= 100, { message: 'A percentage cannot be more than 100.', path: ['discountValue'] });

const noteBody = z.object({ note: z.string().trim().max(500, 'Keep the note under 500 characters.') });

const paidEvent = z.object({
  id: z.string().min(1).max(200),
  type: z.string().max(100),
  couponCode: z.string().min(1).max(100),
  client: z.object({ businessId: z.string().min(1).max(200), name: z.string().max(300).default(''), email: z.string().max(300).default('') }),
  payment: z.object({
    id: z.string().min(1).max(200),
    kind: z.string().max(100).default(''),
    amountCents: z.number().int().min(0),
    currency: z.string().min(1).max(10),
    paidAt: z.union([z.number(), z.string()]),
  }),
});

/** A timestamp header as milliseconds. Seconds, milliseconds and ISO dates are all accepted. */
function headerTime(value: string): number | null {
  const n = Number(value);
  if (Number.isFinite(n) && value.trim() !== '') return n < 1e11 ? n * 1000 : n;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/** `sha256=` + hex HMAC-SHA256 of "timestamp.rawBody". */
export function bbSignature(secret: string, timestamp: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

function signatureMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

function paidAtMs(value: number | string): number {
  if (typeof value === 'number') return value < 1e11 ? value * 1000 : value;
  const t = Date.parse(value);
  return Number.isNaN(t) ? Date.now() : t;
}

export function registerCouponRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;

  /** One call to BrandBasket with our integration key. A network failure or a timeout is a 502 for the caller. */
  async function callBb(path: string, payload: object): Promise<Response> {
    try {
      const target = new URL(`${config.bbApiUrl}${path}`);
      const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${config.integrationKey}` };
      // Windows cannot look up name.localhost addresses, so go to the loopback address and keep the name in the Host header.
      if (target.hostname.endsWith('.localhost')) {
        headers['host'] = target.host;
        target.hostname = '127.0.0.1';
      }
      return await fetch(target, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new HttpError(502, 'bb_unreachable', 'Could not reach BrandBasket. Try again in a moment.');
    }
  }

  /** Creates the code in BrandBasket first, then keeps it here next to the salesperson it belongs to. */
  app.post('/api/admin/coupons', async (request, reply) => {
    const me = superadmin(request);
    const body = couponCreate.parse(request.body);
    const person = await one<{ id: string; name: string }>(db, "SELECT id, name FROM users WHERE id = ? AND role = 'sales' AND active = 1", [body.userId]);
    if (!person) throw new HttpError(404, 'not_found', 'Choose an active salesperson.');
    if (await one(db, 'SELECT 1 AS x FROM coupons WHERE code = ?', [body.code])) throw new HttpError(409, 'duplicate', 'That coupon code already exists.');
    if (!config.integrationKey) throw new HttpError(503, 'not_configured', 'The BrandBasket link is not set up yet (FYNIX_INTEGRATION_KEY).');

    const res = await callBb('/api/integrations/fynix/coupons', {
      code: body.code,
      currency: body.currency,
      discountKind: body.discountKind,
      discountValue: String(body.discountValue),
      ...(body.discountMonths ? { discountMonths: body.discountMonths } : {}),
      ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
      ...(body.maxRedemptions ? { maxRedemptions: body.maxRedemptions } : {}),
    });
    const answer = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 409) throw new HttpError(409, 'duplicate', 'That coupon code already exists in BrandBasket.');
    if (res.status === 422) {
      const field = typeof answer['field'] === 'string' ? `${answer['field']}: ` : '';
      const msg = typeof answer['error'] === 'string' ? answer['error'] : typeof answer['message'] === 'string' ? answer['message'] : 'BrandBasket rejected that coupon.';
      throw new HttpError(422, 'bb_invalid', field + msg);
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'bb_auth', 'BrandBasket did not accept our integration key.');
    if (!res.ok || typeof answer['id'] !== 'string' || !answer['id']) throw new HttpError(502, 'bb_error', 'BrandBasket could not create the coupon. Try again.');

    const id = newId();
    await run(
      db,
      `INSERT INTO coupons (id, code, user_id, bb_coupon_id, currency, discount_kind, discount_value, discount_months, expires_at, max_redemptions, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, body.code, body.userId, answer['id'], body.currency, body.discountKind, String(body.discountValue), body.discountMonths ?? null, body.expiresAt ?? null, body.maxRedemptions ?? null, body.note || null, Date.now()],
    );
    await logActivity(db, null, `${me.name} gave coupon ${body.code} to ${person.name}`, '');
    return reply.status(201).send({ id, code: body.code, userId: body.userId, bbCouponId: answer['id'] });
  });

  app.get('/api/admin/coupons', async (request) => {
    superadmin(request);
    const rows = await all<{
      id: string;
      code: string;
      user_id: string;
      user_name: string;
      currency: string;
      discount_kind: string;
      discount_value: string;
      discount_months: number | null;
      expires_at: string | null;
      max_redemptions: number | null;
      note: string | null;
      created_at: number;
      clients: number;
    }>(
      db,
      `SELECT c.id, c.code, c.user_id, u.name AS user_name, c.currency, c.discount_kind, c.discount_value, c.discount_months, c.expires_at, c.max_redemptions, c.note, c.created_at,
              (SELECT COUNT(DISTINCT p.business_id) FROM coupon_payments p WHERE p.coupon_id = c.id) AS clients
         FROM coupons c JOIN users u ON u.id = c.user_id ORDER BY c.created_at DESC`,
    );
    return {
      coupons: rows.map((c) => ({
        id: c.id,
        code: c.code,
        userId: c.user_id,
        userName: c.user_name,
        currency: c.currency,
        discountKind: c.discount_kind,
        discountValue: c.discount_value,
        discountMonths: c.discount_months,
        expiresAt: c.expires_at,
        maxRedemptions: c.max_redemptions,
        note: c.note ?? '',
        createdAt: c.created_at,
        payingClients: c.clients,
      })),
    };
  });

  /** The note under the code on the salesperson's Coupons tab. An empty note clears it. Nothing is sent to BrandBasket. */
  app.patch<{ Params: { id: string } }>('/api/admin/coupons/:id', async (request) => {
    const me = superadmin(request);
    const body = noteBody.parse(request.body);
    const coupon = await one<{ code: string; user_name: string }>(db, 'SELECT c.code, u.name AS user_name FROM coupons c JOIN users u ON u.id = c.user_id WHERE c.id = ?', [request.params.id]);
    if (!coupon) throw new HttpError(404, 'not_found', 'That coupon does not exist.');
    await run(db, 'UPDATE coupons SET note = ? WHERE id = ?', [body.note || null, request.params.id]);
    await logActivity(db, null, `${me.name} changed the note on coupon ${coupon.code}`, coupon.user_name);
    return { ok: true };
  });

  /**
   * Turns the code off in BrandBasket first, then removes it here, so a failure leaves both sides as they were.
   * A coupon that clients have paid with is kept, because deleting it would erase those payments from the counts.
   */
  app.delete<{ Params: { id: string } }>('/api/admin/coupons/:id', async (request) => {
    const me = superadmin(request);
    const coupon = await one<{ id: string; code: string; bb_coupon_id: string; user_name: string }>(
      db,
      'SELECT c.id, c.code, c.bb_coupon_id, u.name AS user_name FROM coupons c JOIN users u ON u.id = c.user_id WHERE c.id = ?',
      [request.params.id],
    );
    if (!coupon) throw new HttpError(404, 'not_found', 'Coupon not found.');
    if (await one(db, 'SELECT 1 AS x FROM coupon_payments WHERE coupon_id = ? LIMIT 1', [coupon.id])) {
      throw new HttpError(409, 'in_use', 'Clients have already paid with this coupon, so it cannot be removed.');
    }
    if (!config.integrationKey) throw new HttpError(503, 'not_configured', 'The BrandBasket link is not set up yet (FYNIX_INTEGRATION_KEY).');

    const res = await callBb(`/api/integrations/fynix/coupons/${encodeURIComponent(coupon.bb_coupon_id)}/turn-off`, {});
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'bb_auth', 'BrandBasket did not accept our integration key.');
    if (res.status === 404) {
      // BrandBasket answers 404 with a JSON message when it no longer has the code, which is fine to remove here too.
      // A 404 without one means BrandBasket does not have this feature yet.
      const answer = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (typeof answer?.error !== 'string') throw new HttpError(502, 'bb_unsupported', 'BrandBasket cannot turn coupons off yet. Switch the code off in the BrandBasket console instead.');
    } else if (!res.ok) {
      throw new HttpError(502, 'bb_error', 'BrandBasket could not turn the coupon off. Try again.');
    }

    await run(db, 'DELETE FROM coupons WHERE id = ?', [coupon.id]);
    await logActivity(db, null, `${me.name} removed coupon ${coupon.code} from ${coupon.user_name}`, '');
    return { ok: true };
  });

  // The webhook lives in its own scope so the body arrives as the exact text BrandBasket signed.
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => done(null, body));

    scope.post('/api/integrations/bb/coupon-paid', async (request, reply) => {
      const secret = config.webhookSecret;
      if (!secret) throw new HttpError(503, 'not_configured', 'Webhook secret is not set (FYNIX_WEBHOOK_SECRET).');
      const raw = typeof request.body === 'string' ? request.body : '';
      const timestamp = request.headers['x-bb-timestamp'];
      const signature = request.headers['x-bb-signature'];
      if (typeof timestamp !== 'string' || typeof signature !== 'string') throw new HttpError(401, 'bad_signature', 'Missing signature.');
      if (!signatureMatches(bbSignature(secret, timestamp, raw), signature)) throw new HttpError(401, 'bad_signature', 'Bad signature.');
      const sent = headerTime(timestamp);
      if (sent === null || Math.abs(Date.now() - sent) > FIVE_MINUTES) throw new HttpError(401, 'stale', 'Timestamp is too old.');

      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new HttpError(400, 'invalid_request', 'Body is not JSON.');
      }
      const event = paidEvent.parse(json);
      if (event.type !== 'coupon.paid') return reply.send({ ok: true, ignored: 'type' });

      const coupon = await one<{ id: string }>(db, 'SELECT id FROM coupons WHERE code = ?', [event.couponCode.trim().toUpperCase()]);
      if (!coupon) return reply.send({ ok: true, ignored: 'unknown_coupon' });

      const inserted = await run(
        db,
        `INSERT INTO coupon_payments (event_id, coupon_id, business_id, client_name, client_email, payment_id, kind, amount_cents, currency, paid_at, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (event_id) DO NOTHING`,
        [event.id, coupon.id, event.client.businessId, event.client.name, event.client.email, event.payment.id, event.payment.kind, event.payment.amountCents, event.payment.currency.toUpperCase(), paidAtMs(event.payment.paidAt), Date.now()],
      );
      return reply.send({ ok: true, duplicate: inserted.changes === 0 });
    });
  });
}

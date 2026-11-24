import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';

/** Millisecond timestamps are stored as numbers, which need 64 bits. */
const ms = (name: string) => bigint(name, { mode: 'number' });

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull(),
    category: text('category'),
    active: integer('active').notNull().default(1),
    mustChangePassword: integer('must_change_password').notNull().default(0),
    lastLoginAt: ms('last_login_at'),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [
    check('users_role_check', sql`${t.role} IN ('superadmin', 'sales', 'manager')`),
    check('users_category_check', sql`${t.category} IN ('scale', 'reach')`),
    check(
      'users_role_category_check',
      // A manager sees one category, or both when the category is empty.
      sql`(${t.role} = 'superadmin' AND ${t.category} IS NULL) OR (${t.role} = 'sales' AND ${t.category} IS NOT NULL) OR ${t.role} = 'manager'`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ms('expires_at').notNull(),
  },
  (t) => [index('idx_sessions_user').on(t.userId)],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    category: text('category').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    icon: text('icon').notNull(),
    color: text('color').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [unique('workspaces_category_key').on(t.category, t.key), check('workspaces_category_check', sql`${t.category} IN ('scale', 'reach')`)],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const lists = pgTable(
  'lists',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    fileName: text('file_name').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ms('created_at').notNull(),
    /** Set when a superadmin deactivates the list: no new claims, work already claimed carries on. */
    archivedAt: ms('archived_at'),
  },
  (t) => [check('lists_category_check', sql`${t.category} IN ('scale', 'reach')`)],
);

export const workspaceLists = pgTable(
  'workspace_lists',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    listId: text('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.listId] })],
);

export const leads = pgTable(
  'leads',
  {
    id: text('id').primaryKey(),
    listId: text('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    googleCategory: text('google_category').notNull().default(''),
    area: text('area').notNull().default(''),
    city: text('city').notNull().default(''),
    address: text('address').notNull().default(''),
    phone: text('phone').notNull().default(''),
    website: text('website').notNull().default(''),
    emails: text('emails').notNull().default('[]'),
    whatsapp: text('whatsapp').notNull().default(''),
    hours: text('hours').notNull().default('[]'),
    company: text('company').notNull().default(''),
    jobTitle: text('job_title').notNull().default(''),
    personalNumber: text('personal_number').notNull().default(''),
    keywords: text('keywords').notNull().default(''),
    linkedinUrl: text('linkedin_url').notNull().default(''),
    country: text('country').notNull().default(''),
    state: text('state').notNull().default(''),
    /** Every social profile link from the CSV, kept together as a JSON array and shown as one list. */
    socialLinks: text('social_links').notNull().default('[]'),
  },
  (t) => [unique('leads_list_external').on(t.listId, t.externalId), index('idx_leads_list').on(t.listId)],
);

export const claims = pgTable(
  'claims',
  {
    id: text('id').primaryKey(),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull().default('New'),
    nextFollowUp: text('next_follow_up'),
    lastActivityAt: ms('last_activity_at').notNull(),
    createdAt: ms('created_at').notNull(),
    /** 0: unverified / pending, 1: verified (true), 2: rejected (false) */
    verified: integer('verified').notNull().default(0),
    verifiedAt: ms('verified_at'),
    verifiedBy: text('verified_by').references(() => users.id, { onDelete: 'set null' }),
    verificationNote: text('verification_note'),
  },
  (t) => [unique('claims_lead_workspace').on(t.leadId, t.workspaceId), index('idx_claims_owner').on(t.ownerId), index('idx_claims_workspace').on(t.workspaceId)],
);

export const claimEvents = pgTable(
  'claim_events',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    at: ms('at').notNull(),
  },
  (t) => [index('idx_events_claim').on(t.claimId)],
);

export const notes = pgTable(
  'notes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    system: integer('system').notNull().default(0),
    stage: text('stage').notNull(),
    text: text('text').notNull(),
    at: ms('at').notNull(),
    editedAt: ms('edited_at'),
  },
  (t) => [index('idx_notes_claim').on(t.claimId)],
);

export const notices = pgTable(
  'notices',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    sub: text('sub').notNull(),
    at: ms('at').notNull(),
  },
  (t) => [index('idx_notices_user').on(t.userId)],
);

export const notificationReads = pgTable(
  'notification_reads',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const kpiTargets = pgTable(
  'kpi_targets',
  {
    category: text('category').notNull(),
    metric: text('metric').notNull(),
    value: integer('value').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.category, t.metric] }),
    check('kpi_category_check', sql`${t.category} IN ('scale', 'reach')`),
    check('kpi_metric_check', sql`${t.metric} IN ('contacted', 'meetings', 'won')`),
    check('kpi_value_check', sql`${t.value} >= 0`),
  ],
);

export const activity = pgTable(
  'activity',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    at: ms('at').notNull(),
    category: text('category'),
    text: text('text').notNull(),
    sub: text('sub').notNull().default(''),
  },
  (t) => [index('idx_activity_at').on(t.at), check('activity_category_check', sql`${t.category} IN ('scale', 'reach')`)],
);

/** One-time links that let a person choose their own password (new accounts and resets). Only a hash of the link's secret is kept. */
export const invites = pgTable(
  'invites',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ms('expires_at').notNull(),
    usedAt: ms('used_at'),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [index('idx_invites_user').on(t.userId)],
);

/** A discount code made in Fynix, created in BrandBasket too, and credited to the salesperson it was given to. */
export const coupons = pgTable(
  'coupons',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bbCouponId: text('bb_coupon_id').notNull(),
    currency: text('currency').notNull(),
    discountKind: text('discount_kind').notNull(),
    discountValue: text('discount_value').notNull(),
    discountMonths: integer('discount_months'),
    expiresAt: text('expires_at'),
    maxRedemptions: integer('max_redemptions'),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [index('idx_coupons_user').on(t.userId), check('coupons_kind_check', sql`${t.discountKind} IN ('percent', 'amount')`)],
);

/** One verified coupon.paid event from BrandBasket. The event id is the primary key, so a retried delivery cannot count twice. */
export const couponPayments = pgTable(
  'coupon_payments',
  {
    eventId: text('event_id').primaryKey(),
    couponId: text('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'cascade' }),
    businessId: text('business_id').notNull(),
    clientName: text('client_name').notNull(),
    clientEmail: text('client_email').notNull(),
    paymentId: text('payment_id').notNull(),
    kind: text('kind').notNull(),
    amountCents: ms('amount_cents').notNull(),
    currency: text('currency').notNull(),
    paidAt: ms('paid_at').notNull(),
    receivedAt: ms('received_at').notNull(),
  },
  (t) => [index('idx_coupon_payments_coupon').on(t.couponId)],
);

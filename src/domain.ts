import type { Category, Db, Params } from './db.js';
import { all, inClause, one, run } from './db.js';
import type { ParsedLead } from './importer.js';

export const STAGES = ['New', 'Contacted', 'Interested', 'Meeting', 'Negotiation', 'Won', 'Lost'] as const;
export type Stage = (typeof STAGES)[number];

export const CATEGORY_INFO: Record<Category, { name: string; sub: string }> = {
  scale: { name: 'Scale', sub: 'Premium businesses' },
  reach: { name: 'Reach', sub: 'Local businesses' },
};

export const WORKSPACE_ICONS = ['globe', 'seo', 'chat', 'gem', 'pen', 'star'] as const;
export const WORKSPACE_COLORS = ['blue', 'green', 'pink', 'violet', 'amber', 'slate'] as const;
export type WorkspaceIcon = (typeof WORKSPACE_ICONS)[number];
export type WorkspaceColor = (typeof WORKSPACE_COLORS)[number];

export const ICON_COLOR: Record<WorkspaceIcon, WorkspaceColor> = {
  globe: 'blue',
  seo: 'green',
  chat: 'pink',
  gem: 'amber',
  pen: 'violet',
  star: 'amber',
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface ClaimDto {
  id: string;
  owner: string;
  status: string;
  history: { s: string; t: number }[];
  next: string;
  last: number;
  comments: { id: number; by: string; at: number; text: string; stage: string; edited: boolean }[];
}

interface ClaimRow {
  id: string;
  owner_id: string;
  status: string;
  next_follow_up: string | null;
  last_activity_at: number;
}
interface EventRow {
  claim_id: string;
  status: string;
  at: number;
}
interface NoteRow {
  id: number;
  edited_at: number | null;
  claim_id: string;
  author_id: string | null;
  system: number;
  stage: string;
  text: string;
  at: number;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]?.[0], parts[parts.length - 1]?.[0]] : [parts[0]?.slice(0, 2)];
  return letters.filter(Boolean).join('').toUpperCase();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && dateKey(parsed) === value;
}

export function monthStartMs(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

export async function logActivity(db: Db, category: Category | null, text: string, sub = ''): Promise<void> {
  await run(db, 'INSERT INTO activity (at, category, text, sub) VALUES (?, ?, ?, ?)', [Date.now(), category, text, sub]);
}

export async function claimDtos(db: Db, claimIds: string[]): Promise<Map<string, ClaimDto>> {
  const result = new Map<string, ClaimDto>();
  if (claimIds.length === 0) return result;
  const marks = inClause(claimIds);
  const claims = await all<ClaimRow>(db, `SELECT id, owner_id, status, next_follow_up, last_activity_at FROM claims WHERE id IN (${marks})`, claimIds);
  const events = await all<EventRow>(db, `SELECT claim_id, status, at FROM claim_events WHERE claim_id IN (${marks}) ORDER BY at, id`, claimIds);
  const notes = await all<NoteRow>(db, `SELECT id, edited_at, claim_id, author_id, system, stage, text, at FROM notes WHERE claim_id IN (${marks}) ORDER BY at, id`, claimIds);
  for (const claim of claims) {
    result.set(claim.id, {
      id: claim.id,
      owner: claim.owner_id,
      status: claim.status,
      history: [],
      next: claim.next_follow_up ?? '',
      last: claim.last_activity_at,
      comments: [],
    });
  }
  for (const event of events) result.get(event.claim_id)?.history.push({ s: event.status, t: event.at });
  for (const note of notes) {
    result.get(note.claim_id)?.comments.push({
      id: note.id,
      edited: note.edited_at !== null,
      by: note.system === 1 || !note.author_id ? 'sys' : note.author_id,
      at: note.at,
      text: note.text,
      stage: note.stage,
    });
  }
  return result;
}

export async function claimDto(db: Db, claimId: string): Promise<ClaimDto> {
  const dto = (await claimDtos(db, [claimId])).get(claimId);
  if (!dto) throw new HttpError(404, 'not_found', 'That lead is not assigned any more.');
  return dto;
}

export async function categoryOfWorkspace(db: Db, workspaceId: string): Promise<Category | null> {
  return (await one<{ category: Category }>(db, 'SELECT category FROM workspaces WHERE id = ?', [workspaceId]))?.category ?? null;
}

export const LEAD_COLUMNS = [
  'id', 'list_id', 'external_id', 'name', 'google_category', 'area', 'city', 'address', 'phone', 'website',
  'emails', 'whatsapp', 'hours', 'company', 'job_title', 'personal_number', 'keywords', 'linkedin_url', 'country', 'state',
] as const;

/** One parsed CSV row, in the same order as LEAD_COLUMNS. */
export function leadValues(id: string, listId: string, lead: ParsedLead): Params {
  return [
    id, listId, lead.externalId, lead.name, lead.googleCategory, lead.area, lead.city, lead.address, lead.phone, lead.website,
    JSON.stringify(lead.emails), lead.whatsapp, JSON.stringify(lead.hours), lead.company, lead.jobTitle, lead.personalNumber,
    lead.keywords, lead.linkedinUrl, lead.country, lead.state,
  ];
}

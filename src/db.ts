import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

export type Param = string | number | null;
export type Params = Param[];

export const CATEGORIES = ['scale', 'reach'] as const;
export type Category = (typeof CATEGORIES)[number];

export const METRICS = ['contacted', 'meetings', 'won'] as const;
export type Metric = (typeof METRICS)[number];

export const DEFAULT_TARGETS: Record<Metric, number> = { contacted: 20, meetings: 6, won: 3 };

/** What both Postgres drivers (node-postgres and the in-memory PGlite used by tests) can do. */
interface Runner {
  execute(query: SQL): Promise<{ rows: unknown[]; rowCount?: number | null; affectedRows?: number }>;
  transaction<T>(fn: (tx: Runner) => Promise<T>): Promise<T>;
}

export interface Db {
  readonly runner: Runner;
  close(): Promise<void>;
}

const MIGRATIONS = path.resolve(import.meta.dirname, '..', 'drizzle');
const INT8 = 20;
const NUMERIC = 1700;

// Millisecond timestamps and SUM() results come back as 64-bit or numeric values; the app works in plain numbers.
pg.types.setTypeParser(INT8, (value: string) => Number(value));
pg.types.setTypeParser(NUMERIC, (value: string) => Number(value));

async function openPglite(): Promise<{ runner: Runner; close: () => Promise<void> }> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite({ parsers: { [INT8]: (value: string) => Number(value), [NUMERIC]: (value: string) => Number(value) } });
  const orm = drizzle(client, { schema });
  await migrate(orm, { migrationsFolder: MIGRATIONS });
  return { runner: orm as unknown as Runner, close: () => client.close() };
}

async function openPostgres(url: string): Promise<{ runner: Runner; close: () => Promise<void> }> {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const orm = drizzlePg(pool, { schema });
  await migratePg(orm, { migrationsFolder: MIGRATIONS });
  return { runner: orm as unknown as Runner, close: () => pool.end() };
}

/** `:memory:` gives a throwaway in-process Postgres (used by the tests); anything else is a Postgres connection URL. */
export async function openDb(url: string): Promise<Db> {
  const { runner, close } = url === ':memory:' ? await openPglite() : await openPostgres(url);
  const db: Db = { runner, close };
  for (const category of CATEGORIES) {
    for (const metric of METRICS) {
      await run(db, 'INSERT INTO kpi_targets (category, metric, value) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [category, metric, DEFAULT_TARGETS[metric]]);
    }
  }
  return db;
}

/** Turns `?` placeholders into bound parameters, so values never get spliced into the SQL text. */
function toQuery(text: string, params: Params): SQL {
  const parts = text.split('?');
  if (parts.length - 1 !== params.length) {
    throw new Error(`Query has ${parts.length - 1} placeholders but ${params.length} values.`);
  }
  const chunks: SQL[] = [sql.raw(parts[0] ?? '')];
  params.forEach((value, index) => {
    chunks.push(sql`${value}`, sql.raw(parts[index + 1] ?? ''));
  });
  return sql.join(chunks);
}

export async function all<T>(db: Db, text: string, params: Params = []): Promise<T[]> {
  const result = await db.runner.execute(toQuery(text, params));
  return result.rows as T[];
}

export async function one<T>(db: Db, text: string, params: Params = []): Promise<T | undefined> {
  return (await all<T>(db, text, params))[0];
}

export async function run(db: Db, text: string, params: Params = []): Promise<{ changes: number }> {
  const result = await db.runner.execute(toQuery(text, params));
  return { changes: result.rowCount ?? result.affectedRows ?? 0 };
}

/** Runs the callback in one transaction. Use the `db` it receives, not the outer one, for every query inside. */
export async function tx<T>(db: Db, fn: (db: Db) => Promise<T>): Promise<T> {
  return db.runner.transaction((runner) => fn({ runner, close: db.close }));
}

/** Inserts many rows at once, in chunks that stay well under Postgres's 65,535-parameter limit. */
export async function insertMany(db: Db, table: string, columns: readonly string[], rows: Params[]): Promise<void> {
  const perChunk = Math.max(1, Math.floor(30_000 / columns.length));
  for (let start = 0; start < rows.length; start += perChunk) {
    const chunk = rows.slice(start, start + perChunk);
    const marks = chunk.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
    await run(db, `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${marks}`, chunk.flat());
  }
}

export function newId(): string {
  return randomUUID();
}

export function inClause(values: readonly unknown[]): string {
  return values.map(() => '?').join(',');
}

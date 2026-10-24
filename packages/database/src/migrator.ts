import type { Kysely } from 'kysely';
import {
  Migrator,
  NO_MIGRATIONS,
  type MigrationResult,
  type MigrationResultSet,
} from 'kysely/migration';

import { migrations } from '../migrations/index.js';

// Kysely<any>: the migrator works on its own bookkeeping tables, which are not in Database.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = Kysely<any>;

function migrator(db: AnyDb): Migrator {
  return new Migrator({ db, provider: { getMigrations: () => Promise.resolve(migrations) } });
}

// Kysely reports failures in the result instead of throwing; turn them into exceptions.
function check({ error, results = [] }: MigrationResultSet): MigrationResult[] {
  if (error !== undefined) {
    const failed = results.find((r) => r.status === 'Error')?.migrationName ?? 'unknown';
    throw new Error(
      `migration ${failed} failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      { cause: error },
    );
  }
  return results;
}

// Applies every pending migration, each in its own transaction.
export async function migrateUp(db: AnyDb): Promise<MigrationResult[]> {
  return check(await migrator(db).migrateToLatest());
}

// Reverts the latest migration, or all of them.
export async function migrateDown(
  db: AnyDb,
  options: { all?: boolean } = {},
): Promise<MigrationResult[]> {
  const m = migrator(db);
  return check(options.all ? await m.migrateTo(NO_MIGRATIONS) : await m.migrateDown());
}

export async function migrationStatus(
  db: AnyDb,
): Promise<{ name: string; executedAt: Date | null }[]> {
  const infos = await migrator(db).getMigrations();
  return infos.map((m) => ({ name: m.name, executedAt: m.executedAt ?? null }));
}

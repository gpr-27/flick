import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrations } from '../migrations/index.js';
import { migrateDown, migrateUp, migrationStatus } from '../src/migrator.js';
import { APP_TABLES } from '../src/types.js';
import { createTestDatabase, type TestDatabase } from './helpers.js';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase({ migrate: false });
});
afterAll(async () => {
  await t.destroy();
});

async function tables(): Promise<string[]> {
  const r = await sql<{ table_name: string }>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name NOT LIKE 'kysely_%'
    ORDER BY table_name
  `.execute(t.db);
  return r.rows.map((x) => x.table_name);
}

async function enumCount(): Promise<number> {
  const r = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
  `.execute(t.db);
  return r.rows[0]!.n;
}

describe('migrations', () => {
  it('up creates every table', async () => {
    const results = await migrateUp(t.db);
    expect(results.map((r) => r.migrationName)).toEqual(Object.keys(migrations));
    expect(await tables()).toEqual([...APP_TABLES].sort());
    expect((await migrationStatus(t.db)).every((m) => m.executedAt !== null)).toBe(true);
    expect(await migrateUp(t.db)).toEqual([]);
  });

  it('down reverts one migration at a time', async () => {
    const messageTypes = async () =>
      (
        await sql<{ v: string }>`SELECT unnest(enum_range(NULL::message_type))::text AS v`.execute(
          t.db,
        )
      ).rows.map((r) => r.v);
    expect(await messageTypes()).not.toContain('location');
    expect(await tables()).not.toContain('sessions');

    const aboutColumn = async () =>
      (
        await sql<{ column_name: string }>`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'user_settings' AND column_name = 'about_privacy'`.execute(t.db)
      ).rows.length;
    expect(await aboutColumn()).toBe(1);

    const searchIndex = async () =>
      (
        await sql<{ indexdef: string }>`
          SELECT indexdef FROM pg_indexes WHERE indexname = 'messages_search_idx'`.execute(t.db)
      ).rows[0]?.indexdef;
    expect(await searchIndex()).toContain('(conversation_id, search)');

    const aiLanguageColumn = async () =>
      (
        await sql<{ column_name: string }>`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'user_settings' AND column_name = 'ai_language'`.execute(t.db)
      ).rows.length;
    expect(await aiLanguageColumn()).toBe(1);

    const guideColumn = async () =>
      (
        await sql<{ column_name: string }>`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'user_settings' AND column_name = 'guide'`.execute(t.db)
      ).rows.length;
    expect(await guideColumn()).toBe(1);

    expect(await tables()).toContain('reminders');
    await migrateDown(t.db); // undoes 0016 (reminders)
    expect(await tables()).not.toContain('reminders');

    await migrateDown(t.db); // undoes 0013 (the in-app guide)
    expect(await guideColumn()).toBe(0);

    await migrateDown(t.db); // undoes 0012 (saved and scheduled messages)
    expect(await tables()).not.toContain('scheduled_messages');

    await migrateDown(t.db); // undoes 0011 (account settings)
    expect(await aiLanguageColumn()).toBe(0);

    await migrateDown(t.db); // undoes 0010 (search index by conversation)
    expect(await searchIndex()).toContain('(search)');
    expect(await searchIndex()).not.toContain('conversation_id');

    await migrateDown(t.db); // undoes 0009 (about privacy)
    expect(await aboutColumn()).toBe(0);

    await migrateDown(t.db); // undoes 0008 (call links)
    expect(await tables()).not.toContain('call_links');

    await migrateDown(t.db); // undoes 0007 (the trim)
    expect(await messageTypes()).toContain('location');
    expect(await tables()).not.toContain('sessions'); // 0006 (Clerk) still applied

    await migrateDown(t.db); // undoes 0006 (Clerk): sessions come back
    expect(await tables()).toContain('sessions');
    expect(await tables()).toContain('message_events'); // 0005 still applied

    await migrateUp(t.db);
    expect(await messageTypes()).not.toContain('location');
    expect(await tables()).toEqual([...APP_TABLES].sort());
  });

  it('down --all leaves an empty schema, and up works again afterwards', async () => {
    await migrateDown(t.db, { all: true });
    expect(await tables()).toEqual([]);
    expect(await enumCount()).toBe(0);
    await migrateUp(t.db);
    expect(await tables()).toEqual([...APP_TABLES].sort());
  });
});

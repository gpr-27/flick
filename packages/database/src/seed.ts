// Seed data for development, demos and benchmarks.
//
//   tsx src/seed.ts [--scale small|medium|large] [--reset]
//
// --scale  small (default) 50 users / 5k messages, medium 300 / 100k, large 1,000 / 1M.
// --reset  revert and re-apply every migration first (a full rebuild).
// Without --reset the seed empties every table first, so running it twice gives the same counts.
//
// DEMO USERS: alice, bob, carol, dave and erin (and every generated user) are plain local users.
// They have no Clerk account, so nobody can log in as them; they exist so the data looks real.
// To log in as a demo person, create a Clerk user in the dashboard (see docs/security/auth.md).
// Never seed a real deployment.
//
// The output is the same on every run (faker is seeded and used for every random choice),
// except for ids and timestamps.
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

import { faker } from '@faker-js/faker';
import { sql, type Insertable, type Kysely } from 'kysely';
import type pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';

import { loadConfig } from './config.js';
import { createDb, createPool } from './db.js';
import { migrateDown, migrateUp } from './migrator.js';
import { ensureFlickBot } from './bot.js';
import { APP_TABLES, type Database } from './types.js';

export type SeedScale = 'small' | 'medium' | 'large';

export const SCALES = {
  small: { users: 50, directs: 60, groups: 10, messages: 5_000, bigGroup: 0 },
  medium: { users: 300, directs: 600, groups: 60, messages: 100_000, bigGroup: 250 },
  large: { users: 1_000, directs: 3_000, groups: 200, messages: 1_000_000, bigGroup: 600 },
} as const;

export const DEMO_USERNAMES = ['alice', 'bob', 'carol', 'dave', 'erin'] as const;

interface SeedConversation {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  memberIds: string[];
  // Relative share of the messages, so a few chats are busy and most are quiet.
  weight: number;
  lastSeq: number;
  lastMessageAt: Date | null;
}

const DAY = 86_400_000;

// Inserts rows in chunks, staying well under Postgres' 65,535 bind-parameter limit.
async function insertInChunks<T extends keyof Database>(
  db: Kysely<Database>,
  table: T,
  rows: Insertable<Database[T]>[],
) {
  for (let i = 0; i < rows.length; i += 1000) {
    // Kysely cannot type an insert into a table chosen by a generic parameter.
    await db
      .insertInto(table)
      .values(rows.slice(i, i + 1000))
      .execute();
  }
}

// Escapes a value for COPY's text format.
function copyValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

export async function truncateAll(db: Kysely<Database>): Promise<void> {
  await sql.raw(`TRUNCATE ${APP_TABLES.join(', ')} RESTART IDENTITY CASCADE`).execute(db);
}

export async function seed(
  db: Kysely<Database>,
  pool: pg.Pool,
  scale: SeedScale,
): Promise<{ users: number; conversations: number; messages: number }> {
  const spec = SCALES[scale];
  faker.seed(2026);
  const random = () => faker.number.float();
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const now = Date.now();
  const start = now - 90 * DAY;

  await truncateAll(db);
  await ensureFlickBot(db);

  // ---- users and devices ----
  const users: Insertable<Database['users']>[] = DEMO_USERNAMES.map((name) => ({
    id: randomUUID(),
    username: name,
    email: `${name}@example.com`,
    display_name: `${name[0]!.toUpperCase()}${name.slice(1)} Demo`,
    about: 'Demo account',
  }));
  while (users.length < spec.users) {
    const first = faker.person.firstName();
    const last = faker.person.lastName();
    const base = `${first}.${last}`.replace(/[^A-Za-z0-9_.]/g, '').slice(0, 24);
    users.push({
      id: randomUUID(),
      username: `${base}_${users.length}`,
      email: `user${users.length}@example.com`,
      display_name: `${first} ${last}`.slice(0, 64),
      about: random() < 0.5 ? faker.lorem.sentence(5).slice(0, 139) : null,
      last_seen_at: new Date(now - random() * 7 * DAY),
    });
  }
  await insertInChunks(db, 'users', users);
  const userIds = users.map((u) => u.id!);
  const demoIds = userIds.slice(0, DEMO_USERNAMES.length);
  await insertInChunks(
    db,
    'user_settings',
    userIds.map((id) => ({ user_id: id })),
  );

  // Demo users get two devices each, to exercise multi-device delivery.
  const devicesByUser = new Map<string, string[]>();
  const devices: Insertable<Database['devices']>[] = [];
  for (const userId of userIds) {
    const count = demoIds.includes(userId) ? 2 : 1;
    const ids = Array.from({ length: count }, () => randomUUID());
    ids.forEach((id, i) =>
      devices.push({
        id,
        user_id: userId,
        name: i === 0 ? 'Web browser' : 'Desktop app',
        platform: i === 0 ? 'web' : 'desktop',
      }),
    );
    devicesByUser.set(userId, ids);
  }
  await insertInChunks(db, 'devices', devices);

  const contacts = new Map<string, Insertable<Database['contacts']>>();
  for (const owner of userIds) {
    for (let i = 0; i < 10; i++) {
      const other = pick(userIds);
      if (other !== owner)
        contacts.set(`${owner}:${other}`, { owner_id: owner, contact_user_id: other });
    }
  }
  await insertInChunks(db, 'contacts', [...contacts.values()]);

  // ---- conversations ----
  const conversations: SeedConversation[] = [];
  const pairs = new Set<string>();
  const addDirect = (a: string, b: string, weight: number) => {
    const key = [a, b].sort().join(':');
    if (a === b || pairs.has(key)) return;
    pairs.add(key);
    conversations.push({
      id: randomUUID(),
      type: 'direct',
      name: null,
      memberIds: [a, b],
      weight,
      lastSeq: 0,
      lastMessageAt: null,
    });
  };
  const addGroup = (name: string, memberIds: string[], weight: number) => {
    conversations.push({
      id: randomUUID(),
      type: 'group',
      name,
      memberIds,
      weight,
      lastSeq: 0,
      lastMessageAt: null,
    });
  };

  const [alice, bob, carol, dave] = demoIds as [string, string, string, string];
  addDirect(alice, bob, 8);
  addDirect(alice, carol, 4);
  addDirect(bob, dave, 2);
  addGroup('Demo Squad', [...demoIds, ...userIds.slice(5, 12)], 10);
  while (pairs.size < spec.directs) addDirect(pick(userIds), pick(userIds), 0.3 + random() * 2);
  for (let g = 0; g < spec.groups; g++) {
    const members = new Set<string>();
    const size = 3 + Math.floor(random() * 30);
    while (members.size < size) members.add(pick(userIds));
    // Zipf-like weights: the first groups are much busier than the rest.
    addGroup(
      `${faker.word.adjective()} ${faker.word.noun()}`.slice(0, 100),
      [...members],
      6 / Math.pow(g + 1, 0.7),
    );
  }
  if (spec.bigGroup > 0) addGroup('Big group', userIds.slice(0, spec.bigGroup), 4);

  await insertInChunks(
    db,
    'conversations',
    conversations.map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      created_by: c.memberIds[0]!,
      created_at: new Date(start - DAY),
    })),
  );
  await insertInChunks(
    db,
    'direct_pairs',
    conversations
      .filter((c) => c.type === 'direct')
      .map((c) => {
        const [lo, hi] = [...c.memberIds].sort() as [string, string];
        return { user_lo: lo, user_hi: hi, conversation_id: c.id };
      }),
  );

  // ---- messages, bulk-loaded with COPY (far faster than INSERT for 1M rows) ----
  const totalWeight = conversations.reduce((sum, c) => sum + c.weight, 0);
  const counts = conversations.map((c) => Math.floor((c.weight / totalWeight) * spec.messages));
  counts[0]! += spec.messages - counts.reduce((sum, n) => sum + n, 0);
  // A pool of phrases picked at random: calling faker once per row would be slow at 1M rows.
  const phrases = Array.from({ length: 2000 }, (_, i) =>
    i % 3 === 0
      ? faker.lorem.sentence({ min: 3, max: 12 })
      : i % 3 === 1
        ? faker.hacker.phrase()
        : faker.word.words({ count: { min: 1, max: 4 } }),
  );

  function* copyRows(): Generator<string> {
    for (const [i, conv] of conversations.entries()) {
      const n = counts[i]!;
      let chunk = '';
      for (let seq = 1; seq <= n; seq++) {
        // Spread the messages evenly over the last 90 days, in seq order.
        const createdAt = new Date(start + Math.floor(((now - start) * seq) / (n + 1)));
        const sender = pick(conv.memberIds);
        const device = pick(devicesByUser.get(sender)!);
        const fields = [
          randomUUID(),
          conv.id,
          seq,
          sender,
          device,
          randomUUID(),
          'text',
          copyValue(pick(phrases)),
          createdAt.toISOString(),
        ];
        chunk += fields.join('\t') + '\n';
        if (seq % 2000 === 0) {
          yield chunk;
          chunk = '';
        }
      }
      if (chunk) yield chunk;
      conv.lastSeq = n;
      conv.lastMessageAt =
        n > 0 ? new Date(start + Math.floor(((now - start) * n) / (n + 1))) : null;
    }
  }

  const client = await pool.connect();
  try {
    const copy = client.query(
      copyFrom(
        'COPY messages (id, conversation_id, seq, sender_id, sender_device_id, client_message_id, type, body_text, created_at) FROM STDIN',
      ),
    );
    await pipeline(Readable.from(copyRows()), copy);
  } finally {
    client.release();
  }

  // ---- per-conversation state: last_seq, members' read cursors, device delivery cursors ----
  for (const conv of conversations) {
    if (conv.lastSeq > 0) {
      await db
        .updateTable('conversations')
        .set({ last_seq: conv.lastSeq, last_message_at: conv.lastMessageAt })
        .where('id', '=', conv.id)
        .execute();
    }
  }
  const members: Insertable<Database['conversation_members']>[] = [];
  const cursors: Insertable<Database['device_cursors']>[] = [];
  for (const conv of conversations) {
    conv.memberIds.forEach((userId, i) => {
      // About a third of members are a few messages behind, so unread counts vary.
      const readSeq = Math.max(0, conv.lastSeq - (random() < 0.3 ? Math.floor(random() * 20) : 0));
      members.push({
        conversation_id: conv.id,
        user_id: userId,
        role: conv.type === 'group' && i === 0 ? 'owner' : 'member',
        read_seq: readSeq,
      });
      for (const deviceId of devicesByUser.get(userId)!) {
        cursors.push({
          device_id: deviceId,
          conversation_id: conv.id,
          delivered_seq: conv.lastSeq,
          synced_seq: conv.lastSeq,
        });
      }
    });
  }
  await insertInChunks(db, 'conversation_members', members);
  await insertInChunks(db, 'device_cursors', cursors);

  // Fresh planner statistics, so queries right after seeding get realistic plans.
  await sql`ANALYZE`.execute(db);
  return { users: users.length, conversations: conversations.length, messages: spec.messages };
}

function parseArgs(argv: string[]): { scale: SeedScale; reset: boolean } {
  let scale: SeedScale = 'small';
  let reset = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--reset') reset = true;
    else if (arg === '--scale' || arg.startsWith('--scale=')) {
      const value = arg.includes('=') ? arg.split('=')[1] : argv[++i];
      if (value !== 'small' && value !== 'medium' && value !== 'large')
        throw new Error('--scale must be small, medium or large');
      scale = value;
    } else
      throw new Error(
        `unknown argument ${arg}; usage: seed [--scale small|medium|large] [--reset]`,
      );
  }
  return { scale, reset };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  if (config.NODE_ENV === 'production')
    throw new Error('refusing to seed demo accounts with NODE_ENV=production');
  const pool = createPool({ connectionString: config.DATABASE_URL, max: 4 });
  const db = createDb(pool);
  try {
    if (args.reset) await migrateDown(db, { all: true });
    await migrateUp(db);
    const started = Date.now();
    const summary = await seed(db, pool, args.scale);
    console.log(
      JSON.stringify({ scale: args.scale, ...summary, seconds: (Date.now() - started) / 1000 }),
    );
    console.log(`Demo users (plain local users, no Clerk account): ${DEMO_USERNAMES.join(', ')}`);
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

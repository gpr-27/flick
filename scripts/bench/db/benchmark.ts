// Database benchmark: real PostgreSQL, the repo's own query helpers from @chat/db.
//
//   DATABASE_URL=postgres://... BENCH_CONTAINER=<docker container name> \
//     npx tsx --conditions @chat/source scripts/bench/db/run.ts [--only text] [--reps 3] [--tag name]
//
// Every scenario runs `warmup` untimed iterations, then is measured, and is repeated `reps` times.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';

import {
  advanceCursor,
  advanceReadSeq,
  allocateSeqAndInsertMessage,
  buildChatListQuery,
  buildOutboxClaimQuery,
  createDb,
  createPool,
  keysetHistory,
  receiptWatermarks,
  recipientCursors,
  searchMessages,
} from '@chat/db';
import { sql } from 'kysely';

import { loadFixtures, type Target } from './fixtures.js';
import { DockerSampler, measure, median, type Result } from './harness.js';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const ONLY = arg('only', '');
const REPS = Number(arg('reps', '3'));
const MIN_SECONDS = Number(arg('min-seconds', '8'));
const MAX_SECONDS = Number(arg('max-seconds', '30'));
const TAG = arg('tag', 'main');
const CONTAINER = process.env.BENCH_CONTAINER ?? 'chat-dbbench-pg';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

// Same pool size as the API default (DATABASE_POOL_MAX).
const pool = createPool({ connectionString: DATABASE_URL, max: 20 });
const db = createDb(pool);
const sampler = new DockerSampler(CONTAINER);

// ---------------------------------------------------------------- scenarios
interface Scenario {
  name: string;
  concurrency: number[];
  // Runs before every repetition (not timed). May return a cleanup.
  prepare?: () => Promise<void | (() => Promise<void>)>;
  op: (i: number) => Promise<void>;
}

async function main() {
  const fx = await loadFixtures(db);
  const T = fx.targets;
  const pick = <X>(list: X[], i: number) => list[i % list.length]!;
  // No word that the search scenarios look for, so the writes do not change what they find.
  const text = (i: number) => `load ${i} ${randomUUID().slice(0, 8)} ok`;
  const send = (t: Target, clientMessageId: string, i: number) =>
    allocateSeqAndInsertMessage(db, {
      conversationId: t.conversation_id,
      senderId: t.user_id,
      senderDeviceId: t.device_id,
      clientMessageId,
      type: 'text',
      bodyText: text(i),
    });

  // 200 messages that already exist, for the duplicate scenario.
  const existing = T.slice(0, 200).map((t) => ({ t, cmid: randomUUID() }));
  for (const [i, e] of existing.entries()) await send(e.t, e.cmid, i);

  // Outbox backlog helpers.
  const fillOutbox = (n: number) =>
    sql`INSERT INTO outbox (topic, partition_key, payload)
        SELECT 'chat.message.v1', gen_random_uuid()::text, '{"type":"message.created"}'::jsonb
        FROM generate_series(1, ${n})`.execute(db);
  const drainOutbox = async (): Promise<void> => {
    await sql`UPDATE outbox SET published_at = now() WHERE published_at IS NULL`.execute(db);
  };
  const resetBacklog = async () => {
    await sql`TRUNCATE outbox`.execute(db);
    await fillOutbox(10_000);
    await sql`VACUUM ANALYZE outbox`.execute(db);
  };
  // The claim in apps/api/src/modules/dispatcher: BATCH = 100, claim, mark published, commit.
  let refillDebt = 0;
  let refillRunning = false;
  const refiller = async () => {
    while (refillRunning) {
      const n = refillDebt;
      refillDebt = 0;
      if (n > 0) await fillOutbox(n);
      else await new Promise((r) => setTimeout(r, 10));
    }
  };

  const claimOnly = async () => {
    await db
      .transaction()
      .setIsolationLevel('read committed')
      .execute(async (trx) => {
        await buildOutboxClaimQuery(trx, 100).execute();
        // Roll back so the backlog stays the same size and every claim sees 10,000 rows.
        throw new RollbackSignal();
      })
      .catch((err: unknown) => {
        if (!(err instanceof RollbackSignal)) throw err;
      });
  };
  const claimAndPublish = async () => {
    await db.transaction().execute(async (trx) => {
      const rows = await buildOutboxClaimQuery(trx, 100).execute();
      if (rows.length === 0) return;
      await trx
        .updateTable('outbox')
        .set({ published_at: sql<Date>`now()` })
        .where(
          'id',
          'in',
          rows.map((r) => r.id),
        )
        .execute();
      refillDebt += rows.length;
    });
  };

  const scenarios: Scenario[] = [
    // (d) history
    {
      name: 'd1 history: latest 50 (busiest chats)',
      concurrency: [1, 8],
      op: async (i) => {
        const b = pick(fx.busy, i);
        await keysetHistory(db, {
          conversationId: b.conversation_id,
          direction: 'backward',
          limit: 50,
          viewerId: b.user_id,
        });
      },
    },
    {
      name: 'd2 history: deep page (middle of the busiest chat)',
      concurrency: [1, 8],
      op: async () => {
        await keysetHistory(db, {
          conversationId: fx.hot.conversation_id,
          direction: 'backward',
          cursor: Math.floor(fx.hot.last_seq / 2),
          limit: 50,
          viewerId: fx.hot.user_id,
        });
      },
    },
    {
      name: 'd3 history: oldest page (seq < 60)',
      concurrency: [1, 8],
      op: async () => {
        await keysetHistory(db, {
          conversationId: fx.hot.conversation_id,
          direction: 'backward',
          cursor: 60,
          limit: 50,
          viewerId: fx.hot.user_id,
        });
      },
    },
    // (e) chat list
    {
      name: 'e1 chat list: 23 chats (seed maximum)',
      concurrency: [1, 8],
      op: async () => {
        await buildChatListQuery(db, fx.seedUser.user_id).execute();
      },
    },
    {
      name: 'e2 chat list: 1,000 chats (synthetic user)',
      concurrency: [1, 8],
      op: async () => {
        await buildChatListQuery(db, fx.manyChatsUser).execute();
      },
    },
    // (f) membership check, same SQL as requireMember in the API
    {
      name: 'f membership check',
      concurrency: [1, 8],
      op: async (i) => {
        const t = pick(T, i);
        const m = await db
          .selectFrom('conversation_members')
          .select(['role', 'read_seq'])
          .where('conversation_id', '=', t.conversation_id)
          .where('user_id', '=', t.user_id)
          .where('left_at', 'is', null)
          .executeTakeFirst();
        if (!m) throw new Error('not a member');
      },
    },
    // (i) receipts
    {
      name: 'i1 receipts: recipientCursors + watermarks (12-member group)',
      concurrency: [1, 8],
      op: async () => {
        receiptWatermarks(
          await recipientCursors(db, fx.smallGroup.conversation_id, fx.smallGroup.sender),
        );
      },
    },
    {
      name: 'i2 receipts: recipientCursors + watermarks (600-member group)',
      concurrency: [1, 8],
      op: async () => {
        receiptWatermarks(
          await recipientCursors(db, fx.bigGroup.conversation_id, fx.bigGroup.sender),
        );
      },
    },
    // (j) search
    {
      name: 'j1 search: common word "need", user in 23 chats',
      concurrency: [1, 8],
      op: async () => {
        await searchMessages(db, fx.seedUser.user_id, 'need', 20);
      },
    },
    {
      name: 'j2 search: rare word "hello", user in 23 chats',
      concurrency: [1, 8],
      op: async () => {
        await searchMessages(db, fx.seedUser.user_id, 'hello', 20);
      },
    },
    {
      name: 'j3 search: common word "need", user in 1,000 chats',
      concurrency: [1, 8],
      op: async () => {
        await searchMessages(db, fx.manyChatsUser, 'need', 20);
      },
    },
    {
      name: 'j4 search: common word inside one chat',
      concurrency: [1, 8],
      op: async () => {
        await searchMessages(db, fx.hot.user_id, 'need', 20, {
          conversationId: fx.hot.conversation_id,
        });
      },
    },
    // (g) cursors
    {
      name: 'g1 read cursor update (advanceReadSeq)',
      concurrency: [1, 8],
      op: async (i) => {
        const t = pick(T, i);
        await advanceReadSeq(db, {
          conversationId: t.conversation_id,
          userId: t.user_id,
          readSeq: t.last_seq,
        });
      },
    },
    {
      name: 'g2 delivered cursor update (advanceCursor)',
      concurrency: [1, 8],
      op: async (i) => {
        const t = pick(T, i);
        await advanceCursor(db, {
          deviceId: t.device_id,
          conversationId: t.conversation_id,
          deliveredSeq: t.last_seq,
        });
      },
    },
    // (h) outbox
    {
      name: 'h1 outbox claim 100 of 10,000 (claim only, rolled back)',
      concurrency: [1, 4],
      prepare: resetBacklog,
      op: claimOnly,
    },
    {
      name: 'h2 outbox claim 100 + mark published + commit (backlog refilled by a producer)',
      concurrency: [1, 4],
      prepare: async () => {
        await resetBacklog();
        refillRunning = true;
        const loop = refiller();
        return async () => {
          refillRunning = false;
          await loop;
        };
      },
      op: claimAndPublish,
    },
    // (c) duplicates
    {
      name: 'c duplicate submission (same client_message_id)',
      concurrency: [1, 8],
      op: async (i) => {
        const e = pick(existing, i);
        const r = await send(e.t, e.cmid, i);
        if (!r.duplicate) throw new Error('expected a duplicate');
      },
    },
    // (a) distinct conversations, (b) one hot conversation
    {
      name: 'a send: distinct conversations',
      concurrency: [1, 8, 32],
      prepare: drainOutbox,
      op: async (i) => {
        await send(pick(T, i), randomUUID(), i);
      },
    },
    {
      name: 'b send: ONE hot conversation',
      concurrency: [1, 8, 32],
      prepare: drainOutbox,
      op: async (i) => {
        await send(fx.hot, randomUUID(), i);
      },
    },
  ];

  // Start from a clean, vacuumed, analysed state, and clear the statistics so that index usage
  // covers exactly this run.
  await sql`VACUUM ANALYZE`.execute(db);
  await sql`SELECT pg_stat_reset()`.execute(db);
  await sql`SELECT pg_stat_statements_reset()`.execute(db);
  sampler.start();

  const results: Result[] = [];
  for (const s of scenarios) {
    if (ONLY && !s.name.includes(ONLY)) continue;
    for (const concurrency of s.concurrency) {
      for (let rep = 1; rep <= REPS; rep++) {
        const cleanup = await s.prepare?.();
        const r = await measure({
          scenario: s.name,
          concurrency,
          rep,
          pool,
          sampler,
          op: s.op,
          warmup: 200,
          minIterations: 2000,
          minSeconds: MIN_SECONDS,
          maxSeconds: MAX_SECONDS,
        });
        await cleanup?.();
        results.push(r);
        console.log(
          `${s.name} c=${concurrency} rep=${rep}: ${r.qps.toFixed(0)}/s ` +
            `avg ${r.avg_ms.toFixed(2)} p50 ${r.p50_ms.toFixed(2)} p95 ${r.p95_ms.toFixed(2)} ` +
            `p99 ${r.p99_ms.toFixed(2)} max ${r.max_ms.toFixed(1)} ms` +
            (r.errors ? `  ERRORS ${r.errors}: ${r.first_error}` : ''),
        );
      }
    }
  }
  await sampler.stop();

  // Index usage and cost over the whole run.
  const indexes = (
    await sql`
    SELECT relname AS table, indexrelname AS index, idx_scan::int AS scans,
           pg_relation_size(indexrelid) AS bytes
    FROM pg_stat_user_indexes ORDER BY idx_scan, pg_relation_size(indexrelid) DESC`.execute(db)
  ).rows;
  const statements = (
    await sql`
    SELECT left(query, 160) AS query, calls::int, round(total_exec_time::numeric, 0)::int AS total_ms,
           round(mean_exec_time::numeric, 3)::float AS mean_ms, rows::int
    FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat%' ORDER BY total_exec_time DESC LIMIT 20`.execute(
      db,
    )
  ).rows;
  const version = (await sql<{ v: string }>`SELECT version() AS v`.execute(db)).rows[0]!.v;

  const date = new Date().toISOString();
  const out = {
    date,
    node: process.version,
    host: { cpus: os.cpus().length, model: os.cpus()[0]?.model },
    postgres: version,
    settings: {
      reps: REPS,
      warmup: 200,
      minIterations: 2000,
      minSeconds: MIN_SECONDS,
      maxSeconds: MAX_SECONDS,
      poolMax: 20,
    },
    results,
    indexes,
    statements,
  };
  mkdirSync('scripts/bench/db/results', { recursive: true });
  const base = `scripts/bench/db/results/${date.slice(0, 10)}-${TAG}`;
  writeFileSync(`${base}.json`, JSON.stringify(out, null, 2));
  writeFileSync(`${base}.csv`, toCsv(results));
  writeFileSync(`${base}-summary.txt`, summary(results));
  console.log(`\nwrote ${base}.json / .csv / -summary.txt`);
  await db.destroy();
}

class RollbackSignal extends Error {}

function toCsv(rows: Result[]): string {
  const cols = Object.keys(rows[0] ?? {}) as (keyof Result)[];
  const cell = (v: number | string | null) =>
    typeof v === 'number'
      ? String(Math.round(v * 1000) / 1000)
      : `"${(v ?? '').replaceAll('"', '""')}"`;
  return (
    [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n'
  );
}

// Median of the repetitions for each (scenario, concurrency).
function summary(rows: Result[]): string {
  const groups = new Map<string, Result[]>();
  for (const r of rows) {
    const key = `${r.scenario} | c=${r.concurrency}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const m = (g: Result[], f: (r: Result) => number) => median(g.map(f));
  const lines = [
    'scenario | qps (median, min-max) | avg | p50 | p95 | p99 | max (ms, median of reps) | pool busy max/waiting max | pg cpu avg %',
  ];
  for (const [key, g] of groups) {
    const q = g.map((r) => r.qps);
    lines.push(
      `${key} | ${m(g, (r) => r.qps).toFixed(0)} (${Math.min(...q).toFixed(0)}-${Math.max(...q).toFixed(0)}) | ` +
        `${m(g, (r) => r.avg_ms).toFixed(2)} | ${m(g, (r) => r.p50_ms).toFixed(2)} | ${m(g, (r) => r.p95_ms).toFixed(2)} | ` +
        `${m(g, (r) => r.p99_ms).toFixed(2)} | ${m(g, (r) => r.max_ms).toFixed(1)} | ` +
        `${Math.max(...g.map((r) => r.pool_busy_max))}/${Math.max(...g.map((r) => r.pool_waiting_max))} | ` +
        `${g[0]!.pg_cpu_avg_pct === null ? 'n/a' : m(g, (r) => r.pg_cpu_avg_pct ?? 0).toFixed(0)}`,
    );
  }
  return lines.join('\n') + '\n';
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

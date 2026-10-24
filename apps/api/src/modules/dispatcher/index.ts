// The outbox dispatcher: a loop inside the API process.
//
// Each round claims a small batch of unpublished outbox rows (FOR UPDATE SKIP LOCKED, so several
// API replicas can run it at once), emits them to Socket.IO rooms, and marks a row done only after
// its emit attempt succeeded. A crash between emit and commit re-emits the row; clients dedupe by
// seq. A failed row stays in the outbox with attempts+1 and the loop backs off.
import { backoffDelay } from '@chat/shared';
import { buildOutboxClaimQuery, outboxBacklog } from '@chat/db';
import { sql } from 'kysely';
import type { Server } from 'socket.io';
import type { Config } from '../../config.js';
import type { Db } from '../../db.js';
import type { Logger } from '../../logger.js';
import { outboxOldestAge, outboxPending } from '../../metrics.js';
import { dispatchRow, type DispatchContext } from './dispatch.js';

export { NOTIFY_QUEUE } from './dispatch.js';

const BATCH = 100;
const POLL_MS = 200;
/** A row that failed this often is a poison row: log it and move on instead of blocking forever. */
const MAX_ATTEMPTS = 20;
const BACKLOG_EVERY_MS = 5_000;

export interface DispatcherDeps {
  db: Db;
  io: Server;
  config: Config;
  boss: DispatchContext['boss'];
  onMessageCreated?: DispatchContext['onMessageCreated'];
  logger: Logger;
  pollMs?: number;
}

export function createDispatcher(deps: DispatcherDeps) {
  const { db, logger } = deps;
  let stopped = true;
  let loop: Promise<void> | undefined;
  let wake: (() => void) | undefined;

  /** One round: claim, emit, mark. Returns how many rows were claimed and how many failed. */
  async function runOnce(): Promise<{ claimed: number; failed: number }> {
    // Controlled transaction: it has savepoints, and the row locks stay until we commit.
    const trx = await db.startTransaction().execute();
    try {
      const rows = await buildOutboxClaimQuery(trx, BATCH).execute();
      const done: number[] = [];
      let failed = 0;
      // After a failure, later rows of the same conversation wait, so a conversation stays in order.
      const blocked = new Set<string>();
      for (const row of rows) {
        if (blocked.has(row.partition_key)) continue;
        const savepoint = await trx.savepoint('row').execute(); // a SQL error must not abort the batch
        try {
          await dispatchRow(row, { ...deps, db: savepoint });
          await savepoint.releaseSavepoint('row').execute();
          done.push(row.id);
        } catch (error) {
          await savepoint.rollbackToSavepoint('row').execute();
          blocked.add(row.partition_key);
          if (row.attempts + 1 >= MAX_ATTEMPTS) {
            logger.error(
              { error, outboxId: row.id },
              'dropping outbox row after too many attempts',
            );
            done.push(row.id);
          } else {
            failed += 1;
            await trx
              .updateTable('outbox')
              .set({ attempts: row.attempts + 1, last_error: String(error).slice(0, 500) })
              .where('id', '=', row.id)
              .execute();
          }
        }
      }
      if (done.length > 0) {
        await trx
          .updateTable('outbox')
          .set({ published_at: sql<Date>`now()` })
          .where('id', 'in', done)
          .execute();
      }
      await trx.commit().execute();
      return { claimed: rows.length, failed };
    } catch (error) {
      await trx.rollback().execute();
      throw error;
    }
  }

  async function updateBacklogMetrics(): Promise<void> {
    const backlog = await outboxBacklog(db);
    outboxPending.set(backlog.pending);
    outboxOldestAge.set(backlog.oldestAgeSeconds);
  }

  async function run(): Promise<void> {
    let failures = 0;
    let lastBacklog = 0;
    while (!stopped) {
      let delay = deps.pollMs ?? POLL_MS;
      try {
        const result = await runOnce();
        if (result.failed > 0) delay = backoffDelay(++failures, { baseMs: 200, maxMs: 10_000 });
        else {
          failures = 0;
          if (result.claimed === BATCH) delay = 0; // more is waiting
        }
        if (Date.now() - lastBacklog > BACKLOG_EVERY_MS) {
          lastBacklog = Date.now();
          await updateBacklogMetrics();
        }
      } catch (error) {
        logger.error({ error }, 'dispatcher round failed');
        delay = backoffDelay(++failures, { baseMs: 200, maxMs: 10_000 });
      }
      if (delay > 0 && !stopped) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    }
  }

  return {
    runOnce,
    start(): void {
      if (!stopped) return;
      stopped = false;
      loop = run();
    },
    async stop(): Promise<void> {
      stopped = true;
      wake?.();
      await loop;
    },
  };
}
export type Dispatcher = ReturnType<typeof createDispatcher>;

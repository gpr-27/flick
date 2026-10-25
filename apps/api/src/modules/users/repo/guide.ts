import { GUIDE_MAX_TOPICS, GuideState, type UpdateGuideRequest } from '@chat/contracts';
import type { z } from 'zod';
import type { Db } from '../../../db.js';

type Guide = z.infer<typeof GuideState>;
type Times = Guide['seen'];

const EMPTY: Guide = { seen: {}, used: {}, welcome_done_at: null, enabled: true, version: 0 };

/** What is stored may be `{}` (never used) or, in theory, damaged; both read as the defaults. */
function readStored(raw: unknown): Guide {
  const parsed = GuideState.safeParse({ ...EMPTY, ...(raw as object) });
  return parsed.success ? parsed.data : EMPTY;
}

/** Adds the new topics. A topic that is already there keeps its first time. */
function addTopics(current: Times, added: Times | undefined): Times {
  if (!added) return current;
  const merged = { ...current };
  for (const [id, at] of Object.entries(added)) {
    if (id in merged) continue;
    if (Object.keys(merged).length >= GUIDE_MAX_TOPICS) break;
    merged[id] = at;
  }
  return merged;
}

/** Pure merge rules (see UpdateGuideRequest). Exported for the unit tests. */
export function mergeGuide(current: Guide, change: z.infer<typeof UpdateGuideRequest>): Guide {
  const base = change.reset
    ? { ...EMPTY, enabled: current.enabled, version: current.version }
    : current;
  const next: Guide = {
    seen: addTopics(base.seen, change.seen),
    used: addTopics(base.used, change.used),
    welcome_done_at: base.welcome_done_at ?? change.welcome_done_at ?? null,
    enabled: change.enabled ?? base.enabled,
    version: base.version,
  };
  const changed =
    JSON.stringify({ ...next, version: 0 }) !== JSON.stringify({ ...current, version: 0 });
  return { ...next, version: changed ? current.version + 1 : current.version };
}

export async function getGuide(db: Db, userId: string): Promise<Guide> {
  const row = await db
    .selectFrom('user_settings')
    .select('guide')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return readStored(row?.guide);
}

export async function updateGuide(
  db: Db,
  userId: string,
  change: z.infer<typeof UpdateGuideRequest>,
): Promise<Guide> {
  return db.transaction().execute(async (trx) => {
    // The row normally exists since sign-up; make sure it does, then lock it so two devices
    // saving at once merge one after the other instead of overwriting each other.
    await trx
      .insertInto('user_settings')
      .values({ user_id: userId })
      .onConflict((oc) => oc.column('user_id').doNothing())
      .execute();
    const row = await trx
      .selectFrom('user_settings')
      .select('guide')
      .where('user_id', '=', userId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const current = readStored(row.guide);
    const next = mergeGuide(current, change);
    if (next.version !== current.version) {
      await trx
        .updateTable('user_settings')
        .set({ guide: JSON.stringify(next) })
        .where('user_id', '=', userId)
        .execute();
    }
    return next;
  });
}

import type { Database } from '@chat/db';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import type { PgBoss } from 'pg-boss';
import type { Logger } from '../logger.js';
import { callPushTotal } from '../metrics.js';
import { pushToUser, type PushOptions, type PushSender } from '../web-push-provider.js';

export const CALL_PUSH_QUEUE = 'call-push';

/** Same shape the API queues (apps/api/src/modules/gateway/call-push.ts). */
export interface CallPushJob {
  kind: 'ring' | 'cancel';
  user_id: string;
  call_id: string;
  conversation_id: string;
  caller_name: string;
  media: 'audio' | 'video';
  decline_token?: string;
}

export interface CallPushDeps {
  db: Kysely<Database>;
  redis: Redis;
  /** null when no VAPID keys are set: the push is only logged, nothing is sent. */
  sender: PushSender | null;
  logger: Logger;
}

export type CallPushResult = 'sent' | 'simulated' | 'skipped_expired' | 'skipped_online';

// A ringing call is worthless after about half a minute; the push service drops it then.
export const RING_OPTIONS: PushOptions = { ttlSeconds: 30, urgency: 'high' };
// "Missed call" is news for a while, but it is not urgent.
export const CANCEL_OPTIONS: PushOptions = { ttlSeconds: 3_600, urgency: 'normal' };

/** What the service worker receives (apps/web/src/pwa/callPush.ts reads it). */
export const callPushPayload = (job: CallPushJob): string =>
  JSON.stringify({
    type: job.kind === 'ring' ? 'call' : 'call_cancel',
    call_id: job.call_id,
    conversation_id: job.conversation_id,
    caller_name: job.caller_name,
    media: job.media,
    ...(job.decline_token ? { decline_token: job.decline_token } : {}),
  });

// Same keys the API uses (apps/api/src/modules/gateway/presence.ts and parked-calls.ts).
const isOnline = async (redis: Redis, userId: string): Promise<boolean> =>
  (await redis.zcount(`presence:user:${userId}`, Date.now(), '+inf')) > 0;
const isParked = async (redis: Redis, job: CallPushJob): Promise<boolean> =>
  (await redis.exists(`call:parked:${job.user_id}:${job.call_id}`)) === 1;

/**
 * A ring push is skipped if the job ran late: the call was already cancelled or expired, or the
 * person came online meanwhile (then the app itself rings). A cancel push is always sent: it
 * replaces the ring notification, and shows "Missed call" if the ring was never seen.
 */
export async function handleCallPush(
  deps: CallPushDeps,
  job: CallPushJob,
): Promise<CallPushResult> {
  if (job.kind === 'ring') {
    if (!(await isParked(deps.redis, job))) return 'skipped_expired';
    if (await isOnline(deps.redis, job.user_id)) return 'skipped_online';
  }
  if (!deps.sender) {
    deps.logger.info(
      { simulated: true, kind: job.kind, callId: job.call_id, userId: job.user_id },
      'SIMULATED call push (nothing was sent)',
    );
    return 'simulated';
  }
  const options = job.kind === 'ring' ? RING_OPTIONS : CANCEL_OPTIONS;
  await pushToUser(deps.db, deps.sender, deps.logger, job.user_id, callPushPayload(job), options);
  return 'sent';
}

export async function registerCallPush(
  boss: PgBoss,
  deps: CallPushDeps,
  logger: Logger,
): Promise<void> {
  await boss.work<CallPushJob>(CALL_PUSH_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const result = await handleCallPush(deps, job.data);
      callPushTotal.inc({ kind: job.data.kind, result });
      logger.debug({ jobId: job.id, kind: job.data.kind, result }, 'call push job handled');
    }
  });
}

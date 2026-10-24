// The job the API queues for the worker when a call needs a push, or a push to be taken back.
// The worker (apps/worker/src/jobs/call-push.ts) sends it with Web Push.
export const CALL_PUSH_QUEUE = 'call-push';

export interface CallPushJob {
  /** ring: "X is calling". cancel: the call ended before it was answered (a missed call). */
  kind: 'ring' | 'cancel';
  /** The person to notify. */
  user_id: string;
  call_id: string;
  conversation_id: string;
  caller_name: string;
  media: 'audio' | 'video';
  /** ring only: lets the Decline button work with no login. Expires with the parked offer. */
  decline_token?: string;
}

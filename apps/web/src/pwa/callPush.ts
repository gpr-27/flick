// Call pushes: what the worker sends (apps/worker/src/jobs/call-push.ts) and how the service
// worker turns it into a notification and reacts to a tap. Pure, so it is unit-tested without a
// browser. The honest limits (no real ringing, iOS rules) are in docs/features/calls-offline.md.
import { conversationUrl } from './pushPayload';

/** "Someone is calling": shown with Answer / Decline buttons. */
export interface CallPush {
  type: 'call';
  call_id: string;
  conversation_id: string;
  caller_name: string;
  media: 'audio' | 'video';
  /** One-time proof for the Decline button (the worker has no login). */
  decline_token: string;
}
/** The caller gave up or nobody answered in time: take the ring back, show "Missed call". */
export interface CallCancelPush {
  type: 'call_cancel';
  call_id: string;
  conversation_id: string;
  caller_name: string;
  media: 'audio' | 'video';
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Returns null for anything that is not a well-formed call push (it may be a message push). */
export const parseCallPush = (raw: unknown): CallPush | CallCancelPush | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (p.type !== 'call' && p.type !== 'call_cancel') return null;
  if (!isString(p.call_id) || !isString(p.conversation_id)) return null;
  const media: 'audio' | 'video' = p.media === 'video' ? 'video' : 'audio';
  const caller_name = isString(p.caller_name) ? p.caller_name : 'Someone';
  const base = { call_id: p.call_id, conversation_id: p.conversation_id, caller_name, media };
  if (p.type === 'call_cancel') return { type: 'call_cancel', ...base };
  return { type: 'call', ...base, decline_token: isString(p.decline_token) ? p.decline_token : '' };
};

/** Ring, pause, ring... The closest a web page can get to a ringtone while the app is closed. */
export const CALL_VIBRATION = [500, 250, 500, 250, 500, 250, 500, 250, 500, 250, 500];

/** One tag per call: the cancel push replaces the ring notification instead of adding another. */
export const callTag = (callId: string): string => `call-${callId}`;

/** The app reads `?answer=<call id>` and goes straight to the incoming-call screen. */
export const answerUrl = (callId: string): string => `/?answer=${encodeURIComponent(callId)}`;

/** What the notification carries so a tap can be handled later, with no network. */
export interface CallNotificationData {
  kind: 'call' | 'missed';
  url: string;
  call_id: string;
  decline_token?: string;
}

export interface CallNotificationAction {
  action: 'answer' | 'decline';
  title: string;
}
export interface ShownCallNotification {
  title: string;
  options: {
    body: string;
    tag: string;
    icon: string;
    badge: string;
    requireInteraction: boolean;
    renotify: boolean;
    vibrate: number[];
    actions: CallNotificationAction[];
    data: CallNotificationData;
  };
}

const kindOf = (media: 'audio' | 'video'): string =>
  media === 'video' ? 'Video call' : 'Voice call';
const ICONS = { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' };

export const callNotification = (p: CallPush): ShownCallNotification => ({
  title: `${p.caller_name} is calling…`,
  options: {
    body: kindOf(p.media),
    tag: callTag(p.call_id),
    ...ICONS,
    // Stays on screen until tapped (where the platform allows it), instead of fading after seconds.
    requireInteraction: true,
    renotify: true,
    vibrate: CALL_VIBRATION,
    actions: [
      { action: 'answer', title: 'Answer' },
      // Without a token the Decline button could do nothing, so it is not offered.
      ...(p.decline_token ? [{ action: 'decline' as const, title: 'Decline' }] : []),
    ],
    data: {
      kind: 'call',
      url: answerUrl(p.call_id),
      call_id: p.call_id,
      ...(p.decline_token ? { decline_token: p.decline_token } : {}),
    },
  },
});

/** Same tag as the ring, so it takes its place. A short buzz, no buttons, opens the chat. */
export const missedCallNotification = (p: CallCancelPush): ShownCallNotification => ({
  title: `Missed ${p.media === 'video' ? 'video' : 'voice'} call`,
  options: {
    body: `From ${p.caller_name}`,
    tag: callTag(p.call_id),
    ...ICONS,
    requireInteraction: false,
    renotify: true,
    vibrate: [200],
    actions: [],
    data: { kind: 'missed', url: conversationUrl(p.conversation_id), call_id: p.call_id },
  },
});

/** What a tap on a notification should do. */
export type ClickPlan =
  { type: 'decline'; callId: string; token: string } | { type: 'open'; url: string };

export const planClick = (
  action: string,
  data: Partial<CallNotificationData> & { url?: string },
): ClickPlan => {
  if (data.kind === 'call' && action === 'decline' && data.call_id && data.decline_token) {
    return { type: 'decline', callId: data.call_id, token: data.decline_token };
  }
  // Answer, a tap on the body, or Decline without a token (the app then shows Decline itself).
  return { type: 'open', url: data.url ?? '/' };
};

/** The request the Decline button sends. `apiUrl` is the API base (it may carry a path). */
export const declineRequest = (
  apiUrl: string,
  callId: string,
  token: string,
): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } => ({
  url: `${apiUrl.replace(/\/+$/, '')}/calls/decline-from-push`,
  init: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call_id: callId, token }),
  },
});

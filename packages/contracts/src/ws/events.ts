import { z } from 'zod';
import { Cursor, Emoji, Id, IsoDateTime, Seq } from '../common.js';
import { MessageContent } from '../content.js';
import { ErrorBody } from '../errors.js';
import { LIMITS } from '../limits.js';
import { MessageRecord } from '../message.js';
import { ConversationSummary } from '../rest/conversations.js';

// Payload schemas for every WebSocket event. The event map that uses them is in frames.ts.

// ------------------------------------------------------------ shared pieces

const Activity = z.enum(['recording_voice', 'recording_video', 'uploading']);

const SessionDescription = z.object({
  type: z.enum(['offer', 'answer']),
  sdp: z.string().min(1).max(LIMITS.MAX_SDP_LENGTH),
});

const IceCandidate = z.object({
  candidate: z.string().max(2_048),
  sdpMid: z.string().max(64).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).nullable().optional(),
});

// ------------------------------------------------------- client -> server

export const DeliveryAckPayload = z.object({
  /** "I have stored every message up to seq in this conversation." */
  acks: z
    .array(z.object({ conversation_id: Id, seq: Seq }))
    .min(1)
    .max(LIMITS.MAX_ACKS_PER_FRAME),
});

export const TypingPayload = z.object({ conversation_id: Id });

export const ReadAckPayload = z.object({ conversation_id: Id, seq: Seq });

export const ActivityPayload = z.object({
  conversation_id: Id,
  activity: Activity,
  state: z.enum(['start', 'stop']),
});

export const SyncRequestPayload = z.object({
  /** The highest seq the device holds with no gap before it, per conversation. */
  cursors: z.array(z.object({ conversation_id: Id, after_seq: Seq })).max(LIMITS.MAX_SYNC_CURSORS),
  /** next_cursor from the previous sync_page. */
  cursor: Cursor.optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(LIMITS.MAX_SYNC_PAGE_SIZE)
    .default(LIMITS.DEFAULT_SYNC_PAGE_SIZE),
});

export const PresenceSubscribePayload = z.object({
  /** Replaces the whole watch list. An empty list unsubscribes from everyone. */
  user_ids: z.array(Id).max(LIMITS.MAX_PRESENCE_SUBSCRIPTIONS),
});

export const CallOfferPayload = z.object({
  call_id: Id,
  conversation_id: Id,
  media: z.enum(['audio', 'video']),
  sdp: SessionDescription,
});
export const CallAnswerPayload = z.object({ call_id: Id, sdp: SessionDescription });
/** candidate null = no more candidates. */
export const CallIcePayload = z.object({ call_id: Id, candidate: IceCandidate.nullable() });
export const CallEndPayload = z.object({
  call_id: Id,
  reason: z.enum(['hangup', 'timeout', 'failed', 'answered_elsewhere']),
});
export const CallRejectPayload = z.object({ call_id: Id });
export const CallBusyPayload = z.object({ call_id: Id });
/** New offer/answer mid-call: ICE restart, turning video on, screen share. */
export const CallRenegotiatePayload = z.object({ call_id: Id, sdp: SessionDescription });

// ------------------------------------------------------- server -> client

export const MessageFailedPayload = z.object({
  client_message_id: z.string(),
  conversation_id: Id,
  error: ErrorBody,
});

export const NewMessagePayload = z.object({ message: MessageRecord });

// Edits, deletes and reactions each take the next seq in the conversation,
// so they are replayed by sync and gap detection covers them too.
export const MessageEditedPayload = z.object({
  conversation_id: Id,
  seq: Seq,
  message_id: Id,
  content: MessageContent,
  edited_at: IsoDateTime,
});

export const MessageDeletedPayload = z.object({
  conversation_id: Id,
  seq: Seq,
  message_id: Id,
  deleted_by: Id,
  deleted_at: IsoDateTime,
});

export const ReactionPayload = z.object({
  conversation_id: Id,
  seq: Seq,
  message_id: Id,
  user_id: Id,
  emoji: Emoji,
});

export const ReceiptUpdatePayload = z.object({
  conversation_id: Id,
  user_id: Id,
  /** Highest seq delivered to any of this user's devices. */
  delivered_seq: Seq.optional(),
  read_seq: Seq.optional(),
});

export const TypingRelayPayload = z.object({ conversation_id: Id, user_id: Id });

export const ActivityRelayPayload = ActivityPayload.extend({ user_id: Id });

export const PresenceUpdatePayload = z.object({
  user_id: Id,
  online: z.boolean(),
  /** null when the user's privacy settings hide it. */
  last_seen_at: IsoDateTime.nullable(),
});

export const ConversationUpdatedPayload = z.object({
  conversation_id: Id,
  /** null when the user lost access (removed, or left on another device). */
  conversation: ConversationSummary.nullable(),
});

/** A message was pinned or unpinned. Pins take no seq, so they are not replayed by sync. */
export const PinsChangedPayload = z.object({
  conversation_id: Id,
  message_id: Id,
  pinned: z.boolean(),
  actor_user_id: Id,
});

/** Sync replays exactly the events the device would have seen live, in seq order. */
export const SyncEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('new_message'), payload: NewMessagePayload }),
  z.object({ type: z.literal('message_edited'), payload: MessageEditedPayload }),
  z.object({ type: z.literal('message_deleted'), payload: MessageDeletedPayload }),
  z.object({ type: z.literal('reaction_added'), payload: ReactionPayload }),
  z.object({ type: z.literal('reaction_removed'), payload: ReactionPayload }),
]);
export type SyncEvent = z.infer<typeof SyncEvent>;

export const SyncPagePayload = z.object({
  events: z.array(SyncEvent),
  /** Conversations the user no longer belongs to; the client drops them. */
  removed_conversation_ids: z.array(Id),
  /** null when the device is up to date. */
  next_cursor: Cursor.nullable(),
});

/**
 * Sent only to the caller when the call cannot start: the pair is blocked, the callee is offline,
 * or the callee is offline and has no push subscription, so nothing could ring them ('unreachable').
 */
export const CallUnavailablePayload = z.object({
  call_id: Id,
  reason: z.enum(['blocked', 'offline', 'unreachable']),
});

/** The server forwards call events to the other side, adding who sent them. */
const From = { from_user_id: Id };
export const RelayedCall = {
  call_offer: CallOfferPayload.extend(From),
  call_answer: CallAnswerPayload.extend(From),
  call_ice: CallIcePayload.extend(From),
  call_end: CallEndPayload.extend(From),
  call_reject: CallRejectPayload.extend(From),
  call_busy: CallBusyPayload.extend(From),
  call_renegotiate: CallRenegotiatePayload.extend(From),
};

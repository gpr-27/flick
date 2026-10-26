import {
  SERVER_ONLY_CONTENT,
  utf8ByteLength,
  type MessageAccepted,
  type SendMessageInput,
} from '@chat/contracts';
import { allocateSeqAndInsertMessage } from '@chat/db';
import { sql } from 'kysely';
import type { AuthContext } from '../../../auth-guard.js';
import { messageAcceptLatency, messagesAccepted, messagesDuplicate } from '../../../metrics.js';
import { ApiError, toApiError } from '../errors.js';
import type { MessageDeps } from '../deps.js';
import { toStored, type StoredContent } from './content.js';
import { slowModeWait } from '../../grouptools/flagging.js';

/** One message's content may be at most this many bytes of JSON (a max-length text fits). */
// 65,000 characters, worst case: JSON escapes a control character to 6 bytes (\u0000).
const MAX_CONTENT_BYTES = 400 * 1024;

const VIEW_ONCE_TYPES = ['image', 'video', 'voice'];

/**
 * Accepts a message from a client (WebSocket frame or REST). Used by both transports.
 *
 * It returns only after the database transaction has committed, so "accepted" always means
 * "durable". A retry with the same client_message_id returns the original message_id and seq
 * with duplicate: true and creates nothing.
 */
export async function sendMessage(
  deps: MessageDeps,
  auth: AuthContext,
  input: SendMessageInput,
): Promise<MessageAccepted> {
  const startedAt = process.hrtime.bigint(); // monotonic: unaffected by clock changes
  const stored = validateContent(input);
  await checkSenderAllowed(deps, input.conversation_id, auth.userId);
  await checkSlowMode(deps, input.conversation_id, auth.userId, input.client_message_id);
  if (stored.replyToId) await checkReplyTarget(deps, input.conversation_id, stored.replyToId);

  let result;
  try {
    result = await allocateSeqAndInsertMessage(deps.db, {
      conversationId: input.conversation_id,
      senderId: auth.userId,
      senderDeviceId: auth.deviceId,
      clientMessageId: input.client_message_id,
      type: stored.type,
      bodyText: stored.bodyText,
      content: stored.content,
      attachmentId: stored.attachmentId,
      replyToId: stored.replyToId,
      forwarded: stored.forwarded,
      viewOnce: stored.viewOnce,
      mentions: stored.mentions,
    });
  } catch (err) {
    throw toApiError(err);
  }

  if (result.duplicate) {
    messagesDuplicate.inc();
  } else {
    messagesAccepted.inc();
    messageAcceptLatency.observe(Number(process.hrtime.bigint() - startedAt) / 1e9);
  }
  const { message } = result;
  return {
    client_message_id: input.client_message_id,
    message_id: message.id,
    conversation_id: message.conversation_id,
    seq: message.seq,
    created_at: message.created_at.toISOString(),
    duplicate: result.duplicate,
  };
}

function validateContent(input: SendMessageInput): StoredContent {
  const { content } = input;
  // The contract schema already rejects these; checking again keeps this function safe for
  // callers that skipped the schema.
  if (SERVER_ONLY_CONTENT.includes(content.type)) {
    throw new ApiError('FORBIDDEN', `Clients cannot send "${content.type}" messages.`);
  }
  if (content.type === 'poll_vote') {
    throw new ApiError('VALIDATION_FAILED', 'Poll votes are sent to the poll vote endpoint.');
  }
  if (utf8ByteLength(JSON.stringify(content)) > MAX_CONTENT_BYTES) {
    throw new ApiError('PAYLOAD_TOO_LARGE', 'Message is too large.');
  }
  if (content.view_once && !VIEW_ONCE_TYPES.includes(content.type)) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'Only photos, videos and voice notes can be view-once.',
    );
  }
  return toStored(content);
}

/** Membership and block checks in one query. The send transaction re-checks membership. */
async function checkSenderAllowed(deps: MessageDeps, conversationId: string, userId: string) {
  const { rows } = await sql<{ is_member: boolean; blocked: boolean; admins_only: boolean }>`
    SELECT
      EXISTS (SELECT 1 FROM conversation_members m
              JOIN conversations c ON c.id = m.conversation_id
              WHERE m.conversation_id = ${conversationId} AND m.user_id = ${userId}
                AND m.left_at IS NULL AND c.admin_only_send AND m.role = 'member'
             ) AS admins_only,
      EXISTS (SELECT 1 FROM conversation_members
              WHERE conversation_id = ${conversationId} AND user_id = ${userId} AND left_at IS NULL
             ) AS is_member,
      EXISTS (SELECT 1 FROM conversations c
              JOIN conversation_members other ON other.conversation_id = c.id AND other.user_id <> ${userId}
              JOIN blocks b ON b.blocker_id = other.user_id AND b.blocked_id = ${userId}
              WHERE c.id = ${conversationId} AND c.type = 'direct') AS blocked
  `.execute(deps.db);
  if (!rows[0]?.is_member) {
    throw new ApiError('NOT_A_MEMBER', 'You are not a member of this conversation.');
  }
  if (rows[0].blocked) throw new ApiError('BLOCKED', 'You cannot message this user.');
  if (rows[0].admins_only) throw new ApiError('ADMINS_ONLY', 'Only admins can send messages.');
}

/** Group slow mode: members wait `slow_mode_seconds` between messages. Admins are exempt. */
async function checkSlowMode(
  deps: MessageDeps,
  conversationId: string,
  userId: string,
  clientMessageId: string,
) {
  const { rows } = await sql<{ slow: number; role: string; last: Date | null }>`
    SELECT c.slow_mode_seconds AS slow, m.role,
      (SELECT max(created_at) FROM messages
        WHERE conversation_id = c.id AND sender_id = ${userId}
          AND client_message_id <> ${clientMessageId}) AS last
    FROM conversations c
    JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ${userId}
    WHERE c.id = ${conversationId}`.execute(deps.db);
  const row = rows[0];
  if (!row || row.slow <= 0 || row.role !== 'member') return;
  const wait = slowModeWait(row.slow, row.last ? row.last.getTime() : null, Date.now());
  if (wait > 0) {
    throw new ApiError('SLOW_MODE', `Slow mode is on. Wait ${wait}s to send again.`, {
      wait_seconds: wait,
    });
  }
}

async function checkReplyTarget(deps: MessageDeps, conversationId: string, replyToId: string) {
  const target = await deps.db
    .selectFrom('messages')
    .select('id')
    .where('id', '=', replyToId)
    .where('conversation_id', '=', conversationId)
    .executeTakeFirst();
  if (!target) {
    throw new ApiError('VALIDATION_FAILED', 'reply_to must be a message in the same conversation.');
  }
}

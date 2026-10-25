import { sql, type Kysely } from 'kysely';

import type { Database } from '../types.js';
import { DbError } from './errors.js';

// Records how far a device has received (delivery_ack) and synced in a conversation.
// GREATEST makes the cursor monotonic, so a late or repeated ack can never move it back.
// LEAST(..., last_seq) stops a client claiming messages that do not exist yet.
// Returns the stored cursor after the update.
export async function advanceCursor(
  db: Kysely<Database>,
  input: { deviceId: string; conversationId: string; deliveredSeq?: number; syncedSeq?: number },
): Promise<{ deliveredSeq: number; syncedSeq: number }> {
  const result = await sql<{ delivered_seq: number; synced_seq: number }>`
    INSERT INTO device_cursors AS dc (device_id, conversation_id, delivered_seq, synced_seq)
    SELECT ${input.deviceId}, c.id,
           LEAST(${input.deliveredSeq ?? 0}::bigint, c.last_seq),
           LEAST(${input.syncedSeq ?? 0}::bigint, c.last_seq)
    FROM conversations c
    WHERE c.id = ${input.conversationId}
    ON CONFLICT (device_id, conversation_id) DO UPDATE SET
      delivered_seq = GREATEST(dc.delivered_seq, EXCLUDED.delivered_seq),
      synced_seq    = GREATEST(dc.synced_seq, EXCLUDED.synced_seq),
      updated_at    = now()
    RETURNING dc.delivered_seq, dc.synced_seq
  `.execute(db);
  const row = result.rows[0];
  if (!row) throw new DbError('conversation_not_found', 'conversation does not exist');
  return { deliveredSeq: row.delivered_seq, syncedSeq: row.synced_seq };
}

// Moves the user's read cursor forward (never back), capped at the conversation's last_seq.
export async function advanceReadSeq(
  db: Kysely<Database>,
  input: { conversationId: string; userId: string; readSeq: number },
): Promise<number> {
  const result = await sql<{ read_seq: number }>`
    UPDATE conversation_members AS m
    SET read_seq = GREATEST(m.read_seq, LEAST(${input.readSeq}::bigint, c.last_seq))
    FROM conversations c
    WHERE c.id = m.conversation_id
      AND m.conversation_id = ${input.conversationId}
      AND m.user_id = ${input.userId}
      AND m.left_at IS NULL
    RETURNING m.read_seq
  `.execute(db);
  const row = result.rows[0];
  if (!row) throw new DbError('not_a_member', 'user is not a member of the conversation');
  return row.read_seq;
}

export interface RecipientCursor {
  user_id: string;
  // Best delivered_seq over the user's active devices. Reading implies delivery, so it is at least read_seq.
  delivered_seq: number;
  read_seq: number;
}

// The cursors of every other active member: the input for ticks and group "message info".
export async function recipientCursors(
  db: Kysely<Database>,
  conversationId: string,
  senderId: string,
): Promise<RecipientCursor[]> {
  const result = await sql<RecipientCursor>`
    SELECT cm.user_id,
           GREATEST(cm.read_seq, COALESCE(MAX(dc.delivered_seq), 0)) AS delivered_seq,
           cm.read_seq
    FROM conversation_members cm
    LEFT JOIN devices d ON d.user_id = cm.user_id AND d.revoked_at IS NULL
    LEFT JOIN device_cursors dc ON dc.device_id = d.id AND dc.conversation_id = cm.conversation_id
    WHERE cm.conversation_id = ${conversationId} AND cm.left_at IS NULL AND cm.user_id <> ${senderId}
    GROUP BY cm.user_id, cm.read_seq
    ORDER BY cm.user_id
  `.execute(db);
  return result.rows;
}

// A message with seq S is "delivered" when S <= deliveredSeq (every recipient has at least
// one device that acknowledged it) and "read" when S <= readSeq (every recipient read it).
export function receiptWatermarks(cursors: RecipientCursor[]): {
  deliveredSeq: number;
  readSeq: number;
} {
  if (cursors.length === 0) return { deliveredSeq: 0, readSeq: 0 };
  return {
    deliveredSeq: Math.min(...cursors.map((c) => c.delivered_seq)),
    readSeq: Math.min(...cursors.map((c) => c.read_seq)),
  };
}

export interface PeerCursorRow {
  conversation_id: string;
  user_id: string;
  /** Best delivered_seq over the user's active devices (reads are NOT folded in). */
  device_delivered_seq: number;
  read_seq: number;
}

// The cursors of every other active member in each of the given conversations, in one query.
// Callers apply the read-receipt privacy rule before showing read_seq to anyone.
export async function peerCursors(
  db: Kysely<Database>,
  conversationIds: string[],
  viewerId: string,
): Promise<PeerCursorRow[]> {
  if (conversationIds.length === 0) return [];
  const result = await sql<PeerCursorRow>`
    SELECT cm.conversation_id, cm.user_id, cm.read_seq,
           COALESCE(MAX(dc.delivered_seq), 0) AS device_delivered_seq
    FROM conversation_members cm
    LEFT JOIN devices d ON d.user_id = cm.user_id AND d.revoked_at IS NULL
    LEFT JOIN device_cursors dc ON dc.device_id = d.id AND dc.conversation_id = cm.conversation_id
    WHERE cm.conversation_id = ANY(${conversationIds}::uuid[])
      AND cm.left_at IS NULL AND cm.user_id <> ${viewerId}
    GROUP BY cm.conversation_id, cm.user_id, cm.read_seq
    ORDER BY cm.conversation_id, cm.user_id
  `.execute(db);
  return result.rows.map((r) => ({
    ...r,
    device_delivered_seq: Number(r.device_delivered_seq),
    read_seq: Number(r.read_seq),
  }));
}

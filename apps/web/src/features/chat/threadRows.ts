// What the message list shows: the server's messages plus the ones still in the outbox, and the
// status (clock, ticks, failed) of each own message.
import { tickState, type MessageRecord } from '@chat/contracts';
import type { OutboxItem } from './outbox/outboxMachine';

export interface ThreadRow {
  /** Stable across pending -> accepted, so the list does not remount the bubble. */
  key: string;
  message: MessageRecord;
  /** Set while the message is still in the outbox. */
  local: OutboxItem | null;
}

export type RowStatus = 'pending' | 'failed' | 'sent' | 'delivered' | 'read';

const localRecord = (item: OutboxItem): MessageRecord => ({
  message_id: `local:${item.client_message_id}`,
  conversation_id: item.conversation_id,
  seq: 0,
  sender_user_id: item.user_id,
  client_message_id: item.client_message_id,
  content: item.content,
  created_at: new Date(item.created_at).toISOString(),
  edited_at: null,
  deleted_at: null,
  expires_at: null,
  reactions: [],
  starred: false,
  viewed: false,
});

export function buildRows(
  messages: readonly MessageRecord[],
  outbox: readonly OutboxItem[],
  conversationId: string,
): ThreadRow[] {
  const rows: ThreadRow[] = messages.map((message) => ({
    key: message.client_message_id ?? message.message_id,
    message,
    local: null,
  }));
  const held = new Set(messages.map((m) => m.client_message_id));
  const pending = outbox
    .filter((i) => i.conversation_id === conversationId && !held.has(i.client_message_id))
    .sort((a, b) => a.created_at - b.created_at);
  for (const item of pending) {
    rows.push({ key: item.client_message_id, message: localRecord(item), local: item });
  }
  return rows;
}

interface Cursors {
  delivered_seq: number;
  read_seq: number;
}

/**
 * The ticks on an own message. `recipientCount` is how many other members must receive it;
 * recipients we have not heard a receipt from yet count as "nothing delivered", so one silent
 * member keeps a group message at a single tick (the contracts' tickState needs every recipient).
 */
export function rowStatus(
  row: ThreadRow,
  receipts: Record<string, Cursors> | undefined,
  recipientCount: number,
): RowStatus {
  if (row.local) return row.local.status;
  const known = Object.values(receipts ?? {});
  const silent = Array.from({ length: Math.max(0, recipientCount - known.length) }, () => ({
    delivered_seq: 0,
    read_seq: 0,
  }));
  return tickState(row.message.seq, [...known, ...silent]);
}

/**
 * Key of the first unread row when a chat is opened with `unread` new messages: the oldest of
 * the last `unread` messages written by someone else. Undefined when nothing is unread.
 */
export function firstUnreadKey(
  rows: readonly ThreadRow[],
  myId: string,
  unread: number,
): string | undefined {
  if (unread <= 0) return undefined;
  let left = unread;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (!row || row.local || row.message.sender_user_id === myId) continue;
    if (row.message.content?.type === 'system') continue;
    left -= 1;
    if (left === 0) return row.key;
  }
  // Fewer loaded than unread: start at the oldest one we have from someone else.
  for (const row of rows) {
    if (!row.local && row.message.sender_user_id !== myId) return row.key;
  }
  return undefined;
}

/** Messages from one sender on one day, back to back, share an avatar and a name. */
export function groupPosition(
  rows: readonly ThreadRow[],
  index: number,
): { startsGroup: boolean; endsGroup: boolean } {
  const same = (a: ThreadRow | undefined, b: ThreadRow | undefined): boolean =>
    a !== undefined &&
    b !== undefined &&
    a.message.content?.type !== 'system' &&
    b.message.content?.type !== 'system' &&
    a.message.sender_user_id === b.message.sender_user_id &&
    new Date(a.message.created_at).toDateString() === new Date(b.message.created_at).toDateString();
  return {
    startsGroup: !same(rows[index - 1], rows[index]),
    endsGroup: !same(rows[index], rows[index + 1]),
  };
}

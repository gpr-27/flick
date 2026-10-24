// The life of a message the user is sending, as a pure reducer:
//
//   queued ──> pending ──accepted──> (gone: the server's copy takes its place)
//                 │
//                 └──failed──> failed ──retry──> pending      (same client_message_id)
//                                 └──discard──> (gone)
//
// `pending` covers both "waiting for a connection" and "sent, waiting for the server".
// The client_message_id is made once, in `queued`, and never changes: every resend (reconnect,
// Retry button, reload) carries the same id, and the server keeps one message per id, so a
// retry can never create a duplicate.
import type { SendMessageInput } from '@chat/contracts';

export interface OutboxItem {
  client_message_id: string;
  conversation_id: string;
  /** Owner. The outbox lives in the browser, which several accounts may share. */
  user_id: string;
  content: SendMessageInput['content'];
  /** Local clock (epoch ms); only orders the bubbles, never the server's seq. */
  created_at: number;
  status: 'pending' | 'failed';
  error: { code: string; message: string; retryable: boolean } | null;
}

export type OutboxEvent =
  | { type: 'queued'; item: Omit<OutboxItem, 'status' | 'error'> }
  | { type: 'accepted'; client_message_id: string }
  | { type: 'failed'; client_message_id: string; error: NonNullable<OutboxItem['error']> }
  | { type: 'retry'; client_message_id: string }
  | { type: 'discard'; client_message_id: string };

export function reduceOutbox(items: readonly OutboxItem[], event: OutboxEvent): OutboxItem[] {
  const id = event.type === 'queued' ? event.item.client_message_id : event.client_message_id;
  const exists = items.some((i) => i.client_message_id === id);
  const change = (fn: (item: OutboxItem) => OutboxItem): OutboxItem[] =>
    items.map((i) => (i.client_message_id === id ? fn(i) : i));

  switch (event.type) {
    case 'queued':
      return exists ? [...items] : [...items, { ...event.item, status: 'pending', error: null }];
    case 'accepted':
    case 'discard':
      return items.filter((i) => i.client_message_id !== id);
    case 'failed':
      return change((i) => ({ ...i, status: 'failed', error: event.error }));
    case 'retry':
      // Only a failure the server called retryable may be retried; others would fail again.
      return change((i) =>
        i.status === 'failed' && i.error?.retryable !== false
          ? { ...i, status: 'pending', error: null }
          : i,
      );
  }
}

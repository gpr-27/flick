import { z } from 'zod';
import { Cursor, Emoji, Id, IsoDateTime, Paginated, Seq } from '../common.js';
import { MessageContent } from '../content.js';
import { LIMITS } from '../limits.js';
import { MessageRecord, SendMessageInput } from '../message.js';

export const MessageParams = z.object({ conversation_id: Id, message_id: Id });

/** REST fallback for send_message: the conversation id comes from the path. */
export const SubmitMessageRequest = SendMessageInput.omit({ conversation_id: true });

/** History, newest first, keyset on seq: pass before_seq = the smallest seq you hold. */
export const HistoryQuery = z.object({
  before_seq: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.MAX_PAGE_SIZE).default(LIMITS.DEFAULT_PAGE_SIZE),
});
export const HistoryResponse = Paginated(MessageRecord);

/** Only the sender can edit, only text and captions, and only within the edit window. */
export const EditMessageRequest = z.object({ content: MessageContent });

/** "me" hides it for the caller only; "everyone" leaves a tombstone for all (sender only). */
export const DeleteMessageQuery = z.object({ for: z.enum(['me', 'everyone']) });

/** One reaction per user per message: a new emoji replaces the old one. */
export const ReactRequest = z.object({ emoji: Emoji });

/** A vote replaces the caller's previous choice; an empty list removes it. */
export const VoteRequest = z.object({
  option_indexes: z.array(z.number().int().min(0).max(11)).max(12),
});
export const PollTally = z.object({
  message_id: Id,
  question: z.string(),
  allow_multiple: z.boolean(),
  options: z.array(z.object({ index: z.number().int(), text: z.string(), voter_ids: z.array(Id) })),
});

export const PinRequest = z.object({ message_id: Id });
export const PinnedList = z.object({ items: z.array(MessageRecord) });

export const StarredList = Paginated(MessageRecord);

/** Postgres full-text search over the conversations the caller belongs to. */
export const SearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  conversation_id: Id.optional(),
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const SearchHit = z.object({
  message: MessageRecord,
  /** Matched text; `<mark>` is the only markup, everything else is escaped. */
  snippet: z.string(),
});
export const SearchResponse = Paginated(SearchHit);

/** REST fallbacks for delivery_ack / read_ack. */
export const DeliveredRequest = z.object({
  acks: z
    .array(z.object({ conversation_id: Id, seq: Seq }))
    .min(1)
    .max(LIMITS.MAX_ACKS_PER_FRAME),
});
export const ReadRequest = z.object({ seq: Seq });

/** "Message info" for the sender: who has it, who has read it. Derived from the cursors. */
export const MessageInfo = z.object({
  message_id: Id,
  recipients: z.array(z.object({ user_id: Id, delivered: z.boolean(), read: z.boolean() })),
});

/** Who opened a view-once message, for the sender. */
export const ViewOnceOpened = z.object({ message_id: Id, opened_at: IsoDateTime });

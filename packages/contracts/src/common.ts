import { z } from 'zod';
import { LIMITS } from './limits.js';

// Server ids are UUIDs (v7 recommended so they sort by creation time).
export const Id = z.uuid();

/** Client-made idempotency key for a message; reused on every retry. */
export const ClientMessageId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, 'must be 8-64 chars of A-Z a-z 0-9 _ -');

/** Per-conversation sequence number. */
export const Seq = z.number().int().min(0);

export const IsoDateTime = z.iso.datetime({ offset: true });

/** Epoch milliseconds. */
export const EpochMs = z.number().int().min(0);

export const RequestId = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/);

export const HttpUrl = z.url({ protocol: /^https?$/ }).max(4_096);

export const Username = z
  .string()
  .regex(/^[a-z0-9_.]{3,32}$/, '3-32 lowercase letters, digits, _ or .');
export const DisplayName = z.string().trim().min(1).max(64);
export const Emoji = z.string().min(1).max(32);
export const MimeType = z
  .string()
  .max(255)
  .regex(/^[\w.+-]+\/[\w.+-]+$/, 'invalid MIME type');

export const ConversationType = z.enum(['direct', 'group']);
export const MemberRole = z.enum(['owner', 'admin', 'member']);
export type ConversationType = z.infer<typeof ConversationType>;
export type MemberRole = z.infer<typeof MemberRole>;

export const UserSummary = z.object({
  id: Id,
  username: Username,
  display_name: DisplayName,
  avatar_url: HttpUrl.nullable(),
  /** True for the @flick AI bot. */
  is_bot: z.boolean(),
});
export type UserSummary = z.infer<typeof UserSummary>;

// ---------------------------------------------------------------- pagination

/** Opaque keyset cursor made by the server. */
export const Cursor = z.string().min(1).max(512);

/** Query-string pagination; `limit` arrives as a string, so it is coerced. */
export const PageQuery = z.object({
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.MAX_PAGE_SIZE).default(LIMITS.DEFAULT_PAGE_SIZE),
});

/** Every list endpoint returns `{ items, next_cursor }`; next_cursor is null on the last page. */
export function Paginated<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), next_cursor: Cursor.nullable() });
}

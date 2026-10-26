import { z } from 'zod';
import { Id, IsoDateTime } from '../common.js';

/** Saved messages as a second brain, bookmarks, digest and quiet hours. */

export const SavedTag = z.enum(['note', 'link', 'task', 'idea', 'receipt']);
export type SavedTag = z.infer<typeof SavedTag>;

export const AskSavedRequest = z.object({ question: z.string().trim().min(1).max(500) });
export const AskSavedResponse = z.object({
  answer: z.string(),
  sources: z.array(z.object({ message_id: Id, text: z.string(), created_at: IsoDateTime })),
});

export const TagSavedResponse = z.object({
  tags: z.array(z.object({ message_id: Id, tag: SavedTag, text: z.string().optional() })),
});

export const ExtractReminderRequest = z.object({ message_id: Id });
export const ExtractReminderResponse = z.object({
  title: z.string(),
  /** null when no date or time was found. */
  remind_at: IsoDateTime.nullable(),
});

export const MeetingNotesRequest = z.object({
  conversation_id: Id,
  /** How many of the latest messages to summarize. */
  count: z.number().int().min(5).max(200).default(50),
});
export const MeetingNotesResponse = z.object({ text: z.string(), saved: z.boolean() });

export const Digest = z.object({
  reminders_due: z.array(z.object({ id: Id, note: z.string().nullable(), remind_at: IsoDateTime })),
  unread_chats: z.array(z.object({ conversation_id: Id, name: z.string(), unread: z.number() })),
  saved_count: z.number(),
  summary: z.string().nullable(),
});

export type Digest = z.infer<typeof Digest>;

export const BookmarkCollection = z.object({ id: Id, name: z.string() });
export const CollectionList = z.object({ items: z.array(BookmarkCollection) });
export const CreateCollectionRequest = z.object({ name: z.string().trim().min(1).max(40) });
export const CollectionParams = z.object({ collection_id: Id });

export const Bookmark = z.object({
  message_id: Id,
  collection_id: Id,
  conversation_id: Id,
  text: z.string(),
  created_at: IsoDateTime,
});
export const BookmarkList = z.object({ items: z.array(Bookmark) });
export const BookmarkListQuery = z.object({ collection_id: Id.optional() });
export const AddBookmarkRequest = z.object({ message_id: Id, collection_id: Id });
export const BookmarkParams = z.object({ collection_id: Id, message_id: Id });

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const ProductivitySettings = z.object({
  digest: z.enum(['off', 'daily', 'weekly']),
  quiet_enabled: z.boolean(),
  quiet_start: Clock,
  quiet_end: Clock,
  quiet_timezone: z.string().min(1).max(60),
  quiet_days: z.array(z.number().int().min(0).max(6)).max(7),
  priority_contacts: z.array(Id).max(50),
});
export type ProductivitySettings = z.infer<typeof ProductivitySettings>;

/**
 * True when `now` falls inside the person's quiet hours (and today is one of the chosen days).
 * The web app uses it for sounds; the worker has the same logic in apps/worker/src/quiet.ts.
 * A window like 22:00-07:00 crosses midnight; the day counted is the day the window started.
 */
export function isQuietNow(
  s: Pick<
    ProductivitySettings,
    'quiet_enabled' | 'quiet_start' | 'quiet_end' | 'quiet_timezone' | 'quiet_days'
  >,
  now: Date = new Date(),
): boolean {
  if (!s.quiet_enabled) return false;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: s.quiet_timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    return false;
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const toMin = (c: string) => Number(c.slice(0, 2)) * 60 + Number(c.slice(3, 5));
  const start = toMin(s.quiet_start);
  const end = toMin(s.quiet_end);
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end && s.quiet_days.includes(day);
  if (minutes >= start) return s.quiet_days.includes(day);
  if (minutes < end) return s.quiet_days.includes((day + 6) % 7);
  return false;
}

// ── shared events ───────────────────────────────────────────────────────────
export const EventResponse = z.enum(['going', 'maybe', 'no']);
export const CreateEventRequest = z.object({
  conversation_id: Id,
  title: z.string().trim().min(1).max(100),
  starts_at: IsoDateTime,
  place: z.string().trim().min(1).max(200).optional(),
});
export const EventParams = z.object({ message_id: Id });
export const RsvpRequest = z.object({ response: EventResponse });
export const RsvpSummary = z.object({
  going: z.number(),
  maybe: z.number(),
  no: z.number(),
  mine: EventResponse.nullable(),
});
export const EventListItem = z.object({
  message_id: Id,
  conversation_id: Id,
  title: z.string(),
  starts_at: IsoDateTime,
  place: z.string().nullable(),
  mine: EventResponse.nullable(),
});
export const EventList = z.object({ items: z.array(EventListItem) });

// ── follow-up nudges ────────────────────────────────────────────────────────
export const Nudge = z.object({
  message_id: Id,
  conversation_id: Id,
  text: z.string(),
  /** A word from the message ("tuesday", "tomorrow", ...) or null when it names no time. */
  when_hint: z.string().nullable(),
});
export const NudgeList = z.object({ items: z.array(Nudge) });
export type Nudge = z.infer<typeof Nudge>;

import { z } from 'zod';
import { Id, IsoDateTime } from './common.js';

/** An "Event" card: a title, a time and an optional place. Answers (going / maybe / no) live in event_rsvps. */
export const EventContent = z.object({
  type: z.literal('event'),
  title: z.string().trim().min(1).max(100),
  starts_at: IsoDateTime,
  place: z.string().trim().min(1).max(200).optional(),
  reply_to: Id.optional(),
  forwarded: z.boolean().optional(),
  view_once: z.boolean().optional(),
  mentions: z.array(Id).max(256).optional(),
});

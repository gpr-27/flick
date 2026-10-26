import { z } from 'zod';
import { Id, IsoDateTime } from '../common.js';
import { LIMITS } from '../limits.js';

/** Only plain text can be scheduled. The server sends it as the caller at `send_at`. */
export const ScheduleMessageRequest = z.object({
  text: z.string().trim().min(1).max(LIMITS.MAX_TEXT_LENGTH),
  /** Must be between SCHEDULE_MIN_LEAD_S and SCHEDULE_MAX_LEAD_S from now. */
  send_at: IsoDateTime,
});

export const ScheduledMessage = z.object({
  id: Id,
  conversation_id: Id,
  text: z.string(),
  send_at: IsoDateTime,
  /** pending = waiting; failed = could not be sent (see failed_reason). Sent ones leave the list. */
  status: z.enum(['pending', 'failed']),
  failed_reason: z.string().nullable(),
  created_at: IsoDateTime,
});
export type ScheduledMessage = z.infer<typeof ScheduledMessage>;

export const ScheduledList = z.object({ items: z.array(ScheduledMessage) });

export const ScheduledParams = z.object({ scheduled_id: Id });

/** Change a waiting message's text and/or send time (same lead-time rules as scheduling). */
export const UpdateScheduledRequest = z
  .object({
    text: z.string().trim().min(1).max(LIMITS.MAX_TEXT_LENGTH).optional(),
    send_at: IsoDateTime.optional(),
  })
  .refine((v) => v.text !== undefined || v.send_at !== undefined, { message: 'Nothing to change' });

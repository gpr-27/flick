import { z } from 'zod';
import { Id, IsoDateTime, PageQuery, Paginated } from '../common.js';
import { LIMITS } from '../limits.js';

/**
 * Remind me about one message (`message_id`) or about a whole chat (`conversation_id`).
 * Give at least one. With both, the message must be in that chat.
 */
export const CreateReminderRequest = z
  .object({
    message_id: Id.optional(),
    conversation_id: Id.optional(),
    /** Must be between REMINDER_MIN_LEAD_S and REMINDER_MAX_LEAD_S from now. */
    remind_at: IsoDateTime,
    note: z.string().trim().min(1).max(LIMITS.MAX_REMINDER_NOTE_LENGTH).optional(),
  })
  .refine((v) => v.message_id !== undefined || v.conversation_id !== undefined, {
    message: 'Give a message_id or a conversation_id',
    path: ['message_id'],
  });
export type CreateReminderRequest = z.infer<typeof CreateReminderRequest>;

export const Reminder = z.object({
  id: Id,
  conversation_id: Id,
  /** null = a reminder about the whole chat. */
  message_id: Id.nullable(),
  note: z.string().nullable(),
  remind_at: IsoDateTime,
  /** pending = waiting; sent = already delivered (kept in the list for a few days). */
  status: z.enum(['pending', 'sent']),
  created_at: IsoDateTime,
  sent_at: IsoDateTime.nullable(),
  /**
   * Read from the message when the list is built, never stored with the reminder.
   * null when the reminder is about a chat, or the message is gone.
   */
  quote: z.string().nullable(),
  author_name: z.string().nullable(),
  /** The chat's name as this person sees it (the other person's name in a direct chat). */
  chat_name: z.string(),
  /** True when the message was deleted, expired or hidden by this person. */
  message_gone: z.boolean(),
});
export type Reminder = z.infer<typeof Reminder>;

export const ReminderList = Paginated(Reminder);

export const ReminderListQuery = PageQuery;

export const ReminderParams = z.object({ reminder_id: Id });

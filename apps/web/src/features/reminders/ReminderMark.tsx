import { AlarmClock } from 'lucide-react';
import { hasPendingReminder, useReminderStore } from './reminderStore';

/** A small alarm clock on a message that has a reminder waiting. Reads the cached list only. */
export const ReminderMark = ({ messageId }: { messageId: string }) =>
  useReminderStore(hasPendingReminder(messageId)) ? (
    <AlarmClock className="size-3 text-primary" role="img" aria-label="Reminder set" />
  ) : null;

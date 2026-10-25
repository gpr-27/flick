import type { NotificationItem } from '@chat/contracts';

export interface DayGroup {
  label: string;
  items: NotificationItem[];
}

const startOfDay = (d: Date): number =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Today", "Yesterday", or "12 Mar" for a moment. */
export const dayLabel = (iso: string, now: Date = new Date()): string => {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/** Newest-first alerts, split into one group per day (the order is kept). */
export const groupByDay = (items: NotificationItem[], now: Date = new Date()): DayGroup[] => {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const label = dayLabel(item.created_at, now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
};

export const KIND_LABELS: Record<NotificationItem['kind'], string | null> = {
  message: null,
  mention: 'Mention',
  reply: 'Reply',
  reminder: 'Reminder',
  missed_call: 'Missed call',
};

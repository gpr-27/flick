type DateInput = string | number | Date;

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export function formatMessageTime(date: DateInput): string {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// Compact timestamp for the conversation list: "now", "5m", "3h", "Yesterday", "Mon", "12/4".
export function formatRelativeTime(
  date: DateInput | null | undefined,
  now: Date = new Date(),
): string {
  if (date === null || date === undefined || date === '') return '';
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;

  const diffHours = Math.floor(diffMin / 60);
  if (isSameDay(then, now)) return `${diffHours}h`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(then, yesterday)) return 'Yesterday';

  if (diffMs < 7 * 24 * 60 * 60 * 1000) {
    return then.toLocaleDateString('en-US', { weekday: 'short' });
  }
  return then.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}

// Day label shown between groups of messages.
export function formatDateSeparator(date: DateInput, now: Date = new Date()): string {
  const then = new Date(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameDay(then, now)) return 'Today';
  if (isSameDay(then, yesterday)) return 'Yesterday';
  return then.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function isNewDay(prevDate: DateInput | null | undefined, currentDate: DateInput): boolean {
  if (prevDate === null || prevDate === undefined) return true;
  return !isSameDay(new Date(prevDate), new Date(currentDate));
}

// "today at 14:05", "yesterday at 09:30", or the date: for "last seen".
export function formatLastSeen(date: DateInput, now: Date = new Date()): string {
  const then = new Date(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = formatMessageTime(then);
  if (isSameDay(then, now)) return `today at ${time}`;
  if (isSameDay(then, yesterday)) return `yesterday at ${time}`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** 75 -> "1:15", 3725 -> "1:02:05". */
export const formatCallDuration = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** "Today 14:05" or "12 Mar 14:05". */
export const formatCallWhen = (iso: string, now: Date = new Date()): string => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? `Today ${time}`
    : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
};

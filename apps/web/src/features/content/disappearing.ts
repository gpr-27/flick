// Disappearing messages. The server never returns an expired message (so a refresh cannot bring
// one back); this hook hides a message on screen at the moment its `expires_at` passes.
import { useEffect, useState } from 'react';
import type { MessageRecord } from '@chat/contracts';

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export const isExpired = (message: Pick<MessageRecord, 'expires_at'>, now: number): boolean =>
  message.expires_at !== null && Date.parse(message.expires_at) <= now;

export const TIMER_OPTIONS = [
  { seconds: 0, label: 'Off' },
  { seconds: 86_400, label: '24 hours' },
  { seconds: 604_800, label: '7 days' },
  { seconds: 7_776_000, label: '90 days' },
] as const;

export const timerLabel = (seconds: number): string =>
  TIMER_OPTIONS.find((o) => o.seconds === seconds)?.label ?? `${seconds} s`;

/** The rows that have not expired yet; re-renders when the next one does. */
export const useUnexpired = <T extends { message: Pick<MessageRecord, 'expires_at'> }>(
  rows: T[],
): T[] => {
  const [now, setNow] = useState(() => Date.now());
  const visible = rows.filter((r) => !isExpired(r.message, now));

  const nextExpiry = visible.reduce<number>((soonest, r) => {
    const at = r.message.expires_at === null ? Infinity : Date.parse(r.message.expires_at);
    return Math.min(soonest, at);
  }, Infinity);

  useEffect(() => {
    if (nextExpiry === Infinity) return;
    const delay = Math.min(Math.max(0, nextExpiry - Date.now()), MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      setNow(Date.now());
    }, delay + 50);
    return () => {
      clearTimeout(timer);
    };
  }, [nextExpiry, now]);

  return visible.length === rows.length ? rows : visible;
};

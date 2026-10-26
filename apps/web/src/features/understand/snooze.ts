// Snooze a chat until later: it leaves the list until the time passes. Kept on this device.
import { create } from 'zustand';

const KEY = 'flick.snoozes';

const read = (): Record<string, number> => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return typeof v === 'object' && v !== null ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
};

const write = (map: Record<string, number>): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // private mode: the snooze lasts until reload
  }
};

interface SnoozeState {
  until: Record<string, number>;
  snooze: (conversationId: string, until: number) => void;
  clear: (conversationId: string) => void;
}

export const useSnoozes = create<SnoozeState>()((set) => ({
  until: read(),
  snooze: (id, until) => {
    set((s) => {
      const next = { ...s.until, [id]: until };
      write(next);
      return { until: next };
    });
  },
  clear: (id) => {
    set((s) => {
      const { [id]: _gone, ...next } = s.until;
      write(next);
      return { until: next };
    });
  },
}));

export const isSnoozed = (until: Record<string, number>, id: string, now = Date.now()): boolean =>
  (until[id] ?? 0) > now;

export interface SnoozePreset {
  label: string;
  at: (now: Date) => number;
}

const at9 = (now: Date, addDays: number): number => {
  const d = new Date(now);
  d.setDate(d.getDate() + addDays);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
};

export const SNOOZE_PRESETS: readonly SnoozePreset[] = [
  { label: '1 hour', at: (n) => n.getTime() + 3_600_000 },
  { label: '3 hours', at: (n) => n.getTime() + 3 * 3_600_000 },
  { label: 'Tomorrow morning', at: (n) => at9(n, 1) },
  {
    label: 'Next week',
    at: (n) => at9(n, (8 - n.getDay()) % 7 || 7),
  },
];

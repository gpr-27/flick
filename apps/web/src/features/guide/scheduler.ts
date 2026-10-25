// Which queued tip, if any, may be shown right now. Kept as a pure function so the rules that make
// the guide polite are easy to test:
//   - the guide is on, and no tour or tip is already showing;
//   - nothing is in the way (a call, an open dialog, the person typing);
//   - at most one tip a minute;
//   - a topic the person has seen, or whose feature they already used, is never shown.
import { getTopic } from './catalog';
import { tipCooldownMs } from './guideEnv';
import type { Times } from './progress';

/** The least time between two tips. */
export const TIP_COOLDOWN_MS = 60_000;

export interface SchedulerInput {
  queue: readonly string[];
  seen: Times;
  used: Times;
  enabled: boolean;
  /** Something is showing right now. */
  busy: boolean;
  /** A call, an open dialog or menu. */
  blocked: boolean;
  /** The person is typing. */
  typing: boolean;
  /** Tips wait (for example until the welcome tour is done). */
  hold: boolean;
  now: number;
  lastTipAt: number;
}

/** Can this topic still be shown as a tip? */
export const isTipDue = (id: string, seen: Times, used: Times): boolean => {
  const topic = getTopic(id);
  return !!topic && topic.trigger !== 'welcome' && !(id in seen) && !(id in used);
};

export function nextTip(input: SchedulerInput): string | null {
  if (!input.enabled || input.busy || input.blocked || input.typing || input.hold) return null;
  if (input.now - input.lastTipAt < tipCooldownMs(TIP_COOLDOWN_MS)) return null;
  return input.queue.find((id) => isTipDue(id, input.seen, input.used)) ?? null;
}

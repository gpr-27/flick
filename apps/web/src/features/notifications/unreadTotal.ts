// The total unread number shown in the tab title and on the installed app's icon.
import type { ConversationSummary } from '@chat/contracts';
import { formatCount } from '@/components/ui/format';
import { isMuted } from '../organise/prefs';
import { isSnoozed, useSnoozes } from '../understand/snooze';

/** Unread messages across all chats. Muted chats do not count (like the badge on a phone). */
export const totalUnread = (conversations: readonly ConversationSummary[]): number =>
  conversations.reduce(
    (sum, c) =>
      isMuted(c.prefs) || isSnoozed(useSnoozes.getState().until, c.id) ? sum : sum + c.unread_count,
    0,
  );

/** "(3) Flick", "(99+) Flick", or plain "Flick" when nothing is unread. */
export const titleWithUnread = (count: number, base = 'Flick'): string =>
  count > 0 ? `(${formatCount(count)}) ${base}` : base;

// Not in every browser (or every TypeScript lib), so treat both methods as optional.
interface BadgeApi {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/** Sets the app icon badge where the browser supports it. Failures are ignored. */
export const setAppBadge = (count: number): void => {
  const nav: BadgeApi = navigator;
  const call = count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.();
  call?.catch(() => undefined);
};

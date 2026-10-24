import type { ConnectionState } from '@/lib/realtime';

/** Wait this long before showing "Reconnecting…" so brief blips don't flash a banner. */
export const RECONNECT_BANNER_DELAY_MS = 1500;

export interface BannerContent {
  tone: 'offline' | 'reconnecting';
  text: string;
}

export const bannerFor = (state: ConnectionState): BannerContent | null => {
  switch (state) {
    case 'offline':
      return {
        tone: 'offline',
        text: "You're offline. Messages will load again when your connection returns.",
      };
    case 'reconnecting':
      return { tone: 'reconnecting', text: 'Connection lost. Reconnecting…' };
    default:
      return null;
  }
};

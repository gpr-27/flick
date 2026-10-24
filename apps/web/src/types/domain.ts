// App-level types that are not wire formats. Everything that crosses the network is
// typed by @chat/contracts; this file only holds small UI-side shapes.
import type { UserSummary } from '@chat/contracts';

export type CallType = 'audio' | 'video';

/** Who is on the other end of a call, as the call UI needs them. */
export type PeerSummary = Pick<UserSummary, 'id' | 'display_name' | 'avatar_url'>;

export type ThemeMode = 'light' | 'dark';

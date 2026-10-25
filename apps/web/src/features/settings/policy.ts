// Small pure decisions that settings control, kept out of the components so they are easy to test.
import type { MediaAutoDownload, Settings, VideoQuality } from './settingsSchema';

// ------------------------------------------------------------------ quiet hours

const toMinutes = (hhmm: string): number => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/** True when `now` is inside the quiet window. The window may cross midnight (22:00 to 07:00). */
export const inQuietHours = (
  s: Pick<Settings, 'quietHoursOn' | 'quietFrom' | 'quietTo'>,
  now: Date = new Date(),
): boolean => {
  if (!s.quietHoursOn) return false;
  const from = toMinutes(s.quietFrom);
  const to = toMinutes(s.quietTo);
  if (from === to) return false; // an empty window
  const t = now.getHours() * 60 + now.getMinutes();
  return from < to ? t >= from && t < to : t >= from || t < to;
};

// ------------------------------------------------------------------ Enter key

export interface EnterKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

/**
 * What the Enter key does in the (multi-line) message box.
 *  - 'send':    send now (Ctrl or Cmd + Enter in either mode, and plain Enter when "Enter sends" is on);
 *  - 'default': let the text box handle it (a new line: Shift + Enter always, plain Enter when
 *               "Enter sends" is off).
 */
export const enterAction = (enterSends: boolean, e: EnterKey): 'send' | 'default' => {
  if (e.key !== 'Enter' || e.isComposing) return 'default'; // Enter that picks an IME candidate
  if (e.ctrlKey || e.metaKey) return 'send';
  return enterSends && !e.shiftKey ? 'send' : 'default';
};

// ------------------------------------------------------------------ media download

/** The parts of navigator.connection that we use (not in every browser, not in the DOM types). */
export interface ConnectionInfo {
  type?: string;
  effectiveType?: string;
  saveData?: boolean;
}

export const currentConnection = (): ConnectionInfo | undefined =>
  typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { connection?: ConnectionInfo }).connection;

/**
 * Whether photos, videos and voice notes load by themselves.
 * "Wi-Fi only" needs navigator.connection; where the browser does not offer it we cannot tell
 * Wi-Fi from mobile data, so we load (the safe choice for the person reading).
 */
export const mayAutoDownload = (
  setting: MediaAutoDownload,
  connection: ConnectionInfo | undefined = currentConnection(),
): boolean => {
  if (setting === 'always') return true;
  if (setting === 'never') return false;
  if (!connection) return true;
  if (connection.saveData) return false;
  if (connection.type) return connection.type === 'wifi' || connection.type === 'ethernet';
  // Without `type` (Chrome desktop) only the speed class is known: a slow link is not Wi-Fi-like.
  return connection.effectiveType === undefined || connection.effectiveType === '4g';
};

// ------------------------------------------------------------------ video quality

/** The highest video bitrate a call may use, in bits per second. */
export const VIDEO_MAX_BITRATE: Record<VideoQuality, number> = {
  low: 400_000,
  auto: 1_200_000,
  high: 2_500_000,
};

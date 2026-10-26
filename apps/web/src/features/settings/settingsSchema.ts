// Every client-only preference, its default, and the check that keeps a damaged or older saved
// value from breaking the app. Server-backed settings (privacy, AI language) are not here.

export type ThemeChoice = 'light' | 'dark' | 'system';
export type AccentId = 'violet' | 'blue' | 'green' | 'orange' | 'pink' | 'teal';
export type FontSize = 'small' | 'normal' | 'large' | 'xlarge';
export type FontFamily = 'rounded' | 'system' | 'serif' | 'mono';
export type Density = 'comfortable' | 'compact';
export type Corners = 'rounded' | 'sharp';
export type MediaAutoDownload = 'always' | 'wifi' | 'never';
export type VideoQuality = 'low' | 'auto' | 'high';

export interface Settings {
  // Notifications
  messageSound: boolean;
  /** 0 to 1. Used by the message sound and the call ringtone. */
  soundVolume: number;
  ringtoneEnabled: boolean;
  vibration: boolean;
  messagePreviews: boolean;
  quietHoursOn: boolean;
  /** "HH:MM", 24 hour. The window may cross midnight (22:00 to 07:00). */
  quietFrom: string;
  quietTo: string;
  // Appearance
  theme: ThemeChoice;
  accent: AccentId;
  fontSize: FontSize;
  fontFamily: FontFamily;
  density: Density;
  corners: Corners;
  reduceMotion: boolean;
  /** A wallpaper id for chats that have none of their own. */
  defaultWallpaper: string | null;
  /** 0 to 60: how much the chat wallpaper is darkened so message bubbles stay readable. */
  wallpaperDim: number;
  // Chats
  enterSends: boolean;
  showTyping: boolean;
  linkPreviews: boolean;
  mediaAutoDownload: MediaAutoDownload;
  /** Seconds; 0 = off. Applied to chats you start from now on. */
  defaultDisappearing: number;
  /** When false, a new message takes an archived chat out of the archive. */
  keepArchived: boolean;
  // Calls
  cameraOffByDefault: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  videoQuality: VideoQuality;
  relayOnly: boolean;
  // Privacy
  /** Hash of the app lock PIN (see screenLock.ts); null = no lock. */
  screenLockHash: string | null;
  // AI
  showModelName: boolean;
  // Storage
  /** Keep unsent drafts on this device so a reload does not lose them. */
  saveDrafts: boolean;
  // Accessibility
  /** System fonts with wider letter and line spacing. No font download. */
  dyslexiaFont: boolean;
  /** Stronger text and border colours (see [data-contrast='high'] in index.css). */
  highContrast: boolean;
  // Notifications: alerts that get through mute
  /** Words that notify you even in a muted chat. Lower case. */
  keywordAlerts: string[];
  /** User ids whose messages the quiet-hours digest treats as priority. */
  priorityContacts: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  messageSound: true,
  soundVolume: 0.6,
  ringtoneEnabled: true,
  vibration: true,
  messagePreviews: true,
  quietHoursOn: false,
  quietFrom: '22:00',
  quietTo: '07:00',
  theme: 'system',
  accent: 'violet',
  fontSize: 'small',
  fontFamily: 'system',
  density: 'comfortable',
  corners: 'rounded',
  reduceMotion: false,
  defaultWallpaper: null,
  wallpaperDim: 0,
  enterSends: true,
  showTyping: true,
  linkPreviews: true,
  mediaAutoDownload: 'always',
  defaultDisappearing: 0,
  keepArchived: true,
  cameraOffByDefault: false,
  noiseSuppression: true,
  echoCancellation: true,
  videoQuality: 'auto',
  relayOnly: false,
  screenLockHash: null,
  showModelName: true,
  saveDrafts: true,
  dyslexiaFont: false,
  highContrast: false,
  keywordAlerts: [],
  priorityContacts: [],
};

export const DISAPPEARING_CHOICES = [0, 86_400, 604_800, 7_776_000] as const;

const oneOf =
  <T extends string>(...values: T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (values as string[]).includes(v);

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isTime = (v: unknown): v is string =>
  typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === 'string' && x.length <= 64);

/** One check per setting; a value that fails its check is replaced by the default. */
const VALID: { [K in keyof Settings]: (v: unknown) => boolean } = {
  messageSound: isBool,
  soundVolume: (v) => typeof v === 'number' && v >= 0 && v <= 1,
  ringtoneEnabled: isBool,
  vibration: isBool,
  messagePreviews: isBool,
  quietHoursOn: isBool,
  quietFrom: isTime,
  quietTo: isTime,
  theme: oneOf('light', 'dark', 'system'),
  accent: oneOf('violet', 'blue', 'green', 'orange', 'pink', 'teal'),
  fontSize: oneOf('small', 'normal', 'large', 'xlarge'),
  fontFamily: oneOf('rounded', 'system', 'serif', 'mono'),
  density: oneOf('comfortable', 'compact'),
  corners: oneOf('rounded', 'sharp'),
  reduceMotion: isBool,
  defaultWallpaper: (v) => v === null || (typeof v === 'string' && v.length <= 64),
  wallpaperDim: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 60,
  enterSends: isBool,
  showTyping: isBool,
  linkPreviews: isBool,
  mediaAutoDownload: oneOf('always', 'wifi', 'never'),
  defaultDisappearing: (v) => (DISAPPEARING_CHOICES as readonly unknown[]).includes(v),
  keepArchived: isBool,
  cameraOffByDefault: isBool,
  noiseSuppression: isBool,
  echoCancellation: isBool,
  videoQuality: oneOf('low', 'auto', 'high'),
  relayOnly: isBool,
  screenLockHash: (v) => v === null || (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)),
  showModelName: isBool,
  saveDrafts: isBool,
  dyslexiaFont: isBool,
  highContrast: isBool,
  keywordAlerts: isStringList,
  priorityContacts: isStringList,
};

/**
 * Turns whatever was saved (any version, possibly damaged) into valid settings: known keys with
 * a valid value are kept, everything else gets the default. Unknown keys are dropped.
 */
export function sanitizeSettings(saved: unknown): Settings {
  const result: Settings = { ...DEFAULT_SETTINGS };
  if (typeof saved !== 'object' || saved === null) return result;
  const record = saved as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (key in record && VALID[key](record[key])) {
      (result as unknown as Record<string, unknown>)[key] = record[key];
    }
  }
  return result;
}

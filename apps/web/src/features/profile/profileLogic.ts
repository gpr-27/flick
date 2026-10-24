// The rules of the profile page as plain functions, so they are easy to test.

export const DISPLAY_NAME_MAX = 64;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const ABOUT_MAX = 139;
const USERNAME_PATTERN = /^[A-Za-z0-9_.]+$/;

/** Quick statuses that fill the About box. */
export const STATUS_PRESETS = [
  'Available',
  'Busy',
  'At school',
  'At work',
  'In a meeting',
  'Sleeping',
  'Only urgent calls',
] as const;

/** An error message, or null when the value is fine. */
export const validateDisplayName = (value: string): string | null => {
  const name = value.trim();
  if (name.length === 0) return 'Enter a name.';
  if (name.length > DISPLAY_NAME_MAX) return `Use at most ${String(DISPLAY_NAME_MAX)} characters.`;
  return null;
};

export const validateUsername = (value: string): string | null => {
  if (value.length < USERNAME_MIN) return `Use at least ${String(USERNAME_MIN)} characters.`;
  if (value.length > USERNAME_MAX) return `Use at most ${String(USERNAME_MAX)} characters.`;
  if (!USERNAME_PATTERN.test(value)) return 'Only letters, numbers, _ and . are allowed.';
  return null;
};

export const validateAbout = (value: string): string | null =>
  value.length > ABOUT_MAX ? `Use at most ${String(ABOUT_MAX)} characters.` : null;

/** The link people share: it opens this person's profile page in Flick. */
export const profileLink = (origin: string, username: string): string => `${origin}/u/${username}`;

// ------------------------------------------------------------------ completeness

export interface CompletenessInput {
  display_name: string;
  username: string;
  about: string | null;
  avatar_url: string | null;
}

export interface Completeness {
  /** 0, 33, 67 or 100. */
  percent: number;
  photo: boolean;
  about: boolean;
  name: boolean;
  /** One friendly sentence about the next step. */
  hint: string;
}

/** Photo, About and a name that is more than the username (the default from sign-up). */
export const completeness = (p: CompletenessInput): Completeness => {
  const photo = Boolean(p.avatar_url);
  const about = Boolean(p.about?.trim());
  const name =
    p.display_name.trim().length >= 2 &&
    p.display_name.trim().toLowerCase() !== p.username.toLowerCase();
  const done = [photo, about, name].filter(Boolean).length;
  const hint = !photo
    ? 'Add a photo so your friends recognise you.'
    : !about
      ? 'Write a line in About, or pick a status.'
      : !name
        ? 'Set the name you want people to see.'
        : 'Your profile is complete. Nice!';
  return { percent: Math.round((done / 3) * 100), photo, about, name, hint };
};

// ------------------------------------------------------------------ sharing

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Opens the phone's share sheet when there is one (Web Share API); otherwise copies the link.
 * `nav` is a parameter so a test can pass a fake.
 */
export async function shareProfile(
  link: string,
  name: string,
  nav: Pick<Navigator, 'share' | 'clipboard'> = navigator,
): Promise<ShareResult> {
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: `${name} on Flick`, text: `Chat with ${name} on Flick`, url: link });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // any other failure: fall back to copying
    }
  }
  return copyText(link, nav);
}

/** Copies text to the clipboard. */
export async function copyText(
  text: string,
  nav: Pick<Navigator, 'clipboard'> = navigator,
): Promise<'copied' | 'failed'> {
  try {
    await nav.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

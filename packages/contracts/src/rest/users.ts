import { z } from 'zod';
import { LIMITS } from '../limits.js';
import {
  DisplayName,
  HttpUrl,
  Id,
  IsoDateTime,
  Paginated,
  UserSummary,
  Username,
} from '../common.js';

export const Me = z.object({
  id: Id,
  username: Username,
  email: z.email().nullable(),
  display_name: DisplayName,
  about: z.string().max(LIMITS.MAX_ABOUT_LENGTH).nullable(),
  avatar_url: HttpUrl.nullable(),
  is_demo: z.boolean(),
  created_at: IsoDateTime,
});

/** What a person may type as a username. It is stored in lower case. */
export const UsernameInput = z
  .string()
  .regex(/^[A-Za-z0-9_.]{3,32}$/, '3-32 letters, digits, _ or .');

export const UpdateMeRequest = z
  .object({
    display_name: DisplayName,
    username: UsernameInput,
    about: z.string().trim().max(LIMITS.MAX_ABOUT_LENGTH).nullable(),
    /** An attachment uploaded with purpose "avatar"; null removes the avatar. */
    avatar_attachment_id: Id.nullable(),
  })
  .partial();

export const UserSearchQuery = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const UserSearchResponse = Paginated(UserSummary);

/**
 * Everyone on Flick, A to Z by display name. The cursor is the last name of the previous page,
 * so pages stay correct while people sign up in between.
 */
export const DirectoryQuery = z.object({
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const UserParams = z.object({ user_id: Id });

/** A profile as the caller may see it; fields hidden by privacy settings are null. */
export const UserProfile = UserSummary.extend({
  about: z.string().max(LIMITS.MAX_ABOUT_LENGTH).nullable(),
  /** null while online, or when the user hides it. */
  last_seen_at: IsoDateTime.nullable(),
  online: z.boolean(),
  blocked_by_me: z.boolean(),
});

const Audience = z.enum(['everyone', 'nobody']);

export const PrivacySettings = z.object({
  last_seen: Audience,
  profile_photo: Audience,
  about: Audience,
  /** When false, the user neither sends nor sees read receipts. */
  read_receipts: z.boolean(),
});

export const UpdatePrivacyRequest = PrivacySettings.partial();

/** Language names only, so the text is safe to put in an AI prompt. Null = the message's language. */
const AiLanguage = z
  .string()
  .trim()
  .regex(/^[\p{L}][\p{L} ()\-_]{1,39}$/u, 'a language name such as "Hindi" or "French"');

/** Everything stored on the server for one account's settings. */
export const AccountSettings = PrivacySettings.extend({
  /** Who may add me to groups. */
  groups_add: Audience,
  /** The language Flick answers in; null = the language of the message. */
  ai_language: AiLanguage.nullable(),
});

export const UpdateSettingsRequest = AccountSettings.partial();

/** GET /users/username-available?u=... */
export const UsernameAvailableQuery = z.object({ u: z.string().max(64) });
export const UsernameAvailability = z.object({
  available: z.boolean(),
  /** Why not: the text is not a valid username, or someone else has it. */
  reason: z.enum(['invalid', 'taken']).optional(),
});

export const UsernameParams = z.object({ username: z.string().min(1).max(64) });

/** Numbers for the profile page, all computed in one query. */
export const UserStats = z.object({
  chats: z.number().int().min(0),
  groups: z.number().int().min(0),
  days_on_flick: z.number().int().min(1),
  /** The latest time any of my devices was seen. */
  last_active_at: IsoDateTime.nullable(),
});

/** POST /users/me/delete: typing the username is the confirmation. */
export const DeleteAccountRequest = z.object({ username: z.string().min(1).max(64) });

/** The guide is the in-app tour and tips. A topic id is a short lowercase name such as `composer.attach`. */
export const GUIDE_MAX_TOPICS = 200;
export const GuideTopicId = z.string().regex(/^[a-z0-9._-]{1,64}$/, 'a short lowercase topic id');

/** Topic id -> when it happened. At most GUIDE_MAX_TOPICS entries. */
const GuideTimes = z
  .record(GuideTopicId, IsoDateTime)
  .refine((times) => Object.keys(times).length <= GUIDE_MAX_TOPICS, {
    message: `at most ${GUIDE_MAX_TOPICS} topics`,
  });

/** Guide progress that follows the person across devices. Only topic ids and times are stored. */
export const GuideState = z.object({
  /** Topics the person has been shown. */
  seen: GuideTimes,
  /** Topics whose feature the person has already used; these are never shown as tips. */
  used: GuideTimes,
  /** When the welcome tour was finished or skipped; null = not yet. */
  welcome_done_at: IsoDateTime.nullable(),
  /** The "Show tips as I use new features" switch. */
  enabled: z.boolean(),
  /** Counts the changes made, so a client can tell which copy is newer. */
  version: z.number().int().min(0),
});

/**
 * PATCH merges: `seen` and `used` entries are only ever added (an existing time is kept), and
 * `welcome_done_at` is set once. Only `reset: true` clears seen, used and the welcome time (the
 * other fields of the same request are applied after the clearing).
 */
export const UpdateGuideRequest = z.object({
  seen: GuideTimes.optional(),
  used: GuideTimes.optional(),
  welcome_done_at: IsoDateTime.optional(),
  enabled: z.boolean().optional(),
  reset: z.literal(true).optional(),
});

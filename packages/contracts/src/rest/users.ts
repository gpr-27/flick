import { z } from 'zod';
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
  about: z.string().max(280).nullable(),
  avatar_url: HttpUrl.nullable(),
  is_demo: z.boolean(),
  created_at: IsoDateTime,
});

export const UpdateMeRequest = z
  .object({
    display_name: DisplayName,
    about: z.string().max(280).nullable(),
    /** An attachment uploaded with purpose "avatar"; null removes the avatar. */
    avatar_attachment_id: Id.nullable(),
  })
  .partial();

export const UserSearchQuery = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const UserSearchResponse = Paginated(UserSummary);

export const UserParams = z.object({ user_id: Id });

/** A profile as the caller may see it; fields hidden by privacy settings are null. */
export const UserProfile = UserSummary.extend({
  about: z.string().max(280).nullable(),
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

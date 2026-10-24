import type { Me, UserSummary } from '@chat/contracts';
import type { z } from 'zod';
import type { User } from '@chat/db';
import { userAvatarUrl } from '../../../avatars.js';
import type { Config } from '../../../config.js';

export function toMe(config: Config, user: User): z.infer<typeof Me> {
  return {
    id: user.id,
    username: user.username.toLowerCase(),
    email: user.email,
    display_name: user.display_name,
    about: user.about,
    avatar_url: userAvatarUrl(config, user),
    is_demo: user.is_demo,
    created_at: user.created_at.toISOString(),
  };
}

export function toSummary(
  config: Config,
  user: Pick<
    User,
    'id' | 'username' | 'display_name' | 'avatar_object_key' | 'avatar_url' | 'is_bot'
  >,
): UserSummary {
  return {
    id: user.id,
    username: user.username.toLowerCase(),
    display_name: user.display_name,
    avatar_url: userAvatarUrl(config, user),
    is_bot: user.is_bot,
  };
}

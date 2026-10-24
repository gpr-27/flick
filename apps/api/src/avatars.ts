import type { Config } from './config.js';

// Avatars are objects in the media bucket, served by a bucket that allows public reads (as the
// MinIO setup in infra/ does). With no storage configured there is no uploaded avatar.
export function mediaUrl(config: Config, objectKey: string | null): string | null {
  if (objectKey && config.S3_PUBLIC_URL)
    return `${config.S3_PUBLIC_URL.replace(/\/+$/, '')}/${objectKey}`;
  if (!objectKey || !config.S3_ENDPOINT || !config.S3_BUCKET) return null;
  return `${config.S3_ENDPOINT.replace(/\/+$/, '')}/${config.S3_BUCKET}/${objectKey}`;
}

/** A user's avatar: the picture they uploaded, else the Clerk profile picture, else none. */
export function userAvatarUrl(
  config: Config,
  user: { avatar_object_key: string | null; avatar_url: string | null },
): string | null {
  return mediaUrl(config, user.avatar_object_key) ?? user.avatar_url;
}

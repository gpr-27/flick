import { LIMITS } from '@chat/contracts';

export type Purpose = 'message' | 'avatar' | 'group_avatar';

const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Voice notes are just audio files; the waveform and duration travel inside the message content.
const MESSAGE_TYPES = [
  ...AVATAR_TYPES,
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
  'application/pdf',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

export const ALLOWED_TYPES: Record<Purpose, string[]> = {
  message: MESSAGE_TYPES,
  avatar: AVATAR_TYPES,
  group_avatar: AVATAR_TYPES,
};

export const MAX_BYTES: Record<Purpose, number> = {
  message: LIMITS.MAX_UPLOAD_BYTES,
  avatar: LIMITS.MAX_AVATAR_BYTES,
  group_avatar: LIMITS.MAX_AVATAR_BYTES,
};

const KEY_DIR: Record<Purpose, string> = {
  message: 'messages',
  avatar: 'avatars',
  group_avatar: 'group-avatars',
};

/** The key is built from ids only. The user's file name never becomes part of it. */
export function objectKey(purpose: Purpose, userId: string, attachmentId: string): string {
  return `${KEY_DIR[purpose]}/${userId}/${attachmentId}`;
}

export function isAvatarKey(key: string): boolean {
  return key.startsWith('avatars/') || key.startsWith('group-avatars/');
}

/** Keeps a display name that is safe to show and to put in a Content-Disposition header. */
export function sanitizeFileName(name: string | undefined): string | null {
  if (!name) return null;
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/^[. ]+/, '')
    .trim()
    .slice(0, 100);
  return clean || null;
}

// Different names for the same container, e.g. an m4a voice note is detected as video/mp4.
const SAME_CONTAINER: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'video/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'mp4',
  'video/mp4': 'mp4',
  'audio/mp3': 'mp3',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/vnd.wave': 'wav',
};

export function sameType(declared: string, detected: string): boolean {
  return (SAME_CONTAINER[declared] ?? declared) === (SAME_CONTAINER[detected] ?? detected);
}

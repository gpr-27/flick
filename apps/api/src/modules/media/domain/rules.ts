import { LIMITS } from '@chat/contracts';

export type Purpose = 'message' | 'avatar' | 'group_avatar';

// Avatars are decoded and re-encoded by sharp, so only formats it reads everywhere are allowed.
// HEIC/HEIF are not accepted: the prebuilt libvips has no HEVC decoder, so they could not be
// converted. AVIF is decoded by the same build.
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/**
 * Message attachments accept any file type (photos, video, audio, documents, archives, ...).
 * Safety does not come from an allowlist but from how downloads are served (see canShowInline).
 */
export function isTypeAllowed(purpose: Purpose, mime: string): boolean {
  if (purpose === 'message') return true;
  return AVATAR_TYPES.includes(mime.toLowerCase());
}

/** Kept for callers that list the restricted purposes. `message` accepts everything. */
export const ALLOWED_TYPES: Record<Exclude<Purpose, 'message'>, string[]> = {
  avatar: AVATAR_TYPES,
  group_avatar: AVATAR_TYPES,
};

// Declared types whose bytes we can and do verify. If one of these is declared, the content
// must really be that container, otherwise the upload is rejected. Every other type (including
// application/octet-stream and types file-type does not know) is accepted as declared.
const VERIFIED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'video/mp4',
  'video/webm',
  'application/pdf',
]);

/** Decides if the sniffed type is acceptable for the declared one. `detected` may be unknown. */
export function declaredMatches(declared: string, detected: string | undefined): boolean {
  const d = declared.toLowerCase();
  if (!VERIFIED_TYPES.has(d)) return true;
  if (!detected) return false;
  return sameType(d, detected);
}

/**
 * Only plain media may be shown by the browser itself. HTML, SVG, XML, JavaScript, PDF and
 * everything unknown are always sent as a download, so an uploaded file can never run as a page.
 */
export function canShowInline(mime: string): boolean {
  const m = mime.toLowerCase();
  if (m === 'image/svg+xml' || m.includes('xml') || m.includes('html') || m.includes('script')) {
    return false;
  }
  return m.startsWith('image/') || m.startsWith('audio/') || m.startsWith('video/');
}

/** The Content-Type a download is served with: the real one for inline media, else opaque. */
export function downloadContentType(mime: string): string {
  return canShowInline(mime) ? mime : 'application/octet-stream';
}

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

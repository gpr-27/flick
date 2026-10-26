export const MEDIA = ['images', 'video', 'audio', 'files', 'links'] as const;
export interface SearchFilters {
  sender?: string;
  from?: string;
  to?: string;
  media?: (typeof MEDIA)[number];
  starred?: boolean;
  pinned?: boolean;
}

/** The filters as API query params; unset ones are left out. */
export const filterParams = (f: SearchFilters): Record<string, string> => ({
  ...(f.sender ? { sender_id: f.sender } : {}),
  ...(f.from ? { from: new Date(f.from).toISOString() } : {}),
  ...(f.to ? { to: new Date(`${f.to}T23:59:59`).toISOString() } : {}),
  ...(f.media ? { media: f.media } : {}),
  ...(f.starred ? { starred: 'true' } : {}),
  ...(f.pinned ? { pinned: 'true' } : {}),
});

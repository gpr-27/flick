// Which wallpaper a chat shows: its own pick, else the one for all chats, else the normal
// background (null). Used by the chat screen, the previews and the "which one is this" labels.
export type WallpaperSource = 'chat' | 'global' | 'none';

export const resolveWallpaperId = (
  chatId: string | null | undefined,
  globalId: string | null | undefined,
): string | null => chatId ?? globalId ?? null;

export const wallpaperSource = (
  chatId: string | null | undefined,
  globalId: string | null | undefined,
): WallpaperSource => (chatId ? 'chat' : globalId ? 'global' : 'none');

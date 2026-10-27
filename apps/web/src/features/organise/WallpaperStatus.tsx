// Under the "Chat wallpaper" title of a chat: does this chat follow the wallpaper for all chats
// or have one of its own?
import { useSettingsStore } from '@/features/settings/useSettingsStore';
import { wallpaperSource } from './wallpaperPrecedence';

export const WallpaperStatus = ({ own }: { own: string | null }) => {
  const global = useSettingsStore((s) => s.defaultWallpaper);
  const source = wallpaperSource(own, global);
  return (
    <p className="mb-2 text-sm opacity-70" data-testid="wallpaper-status">
      This chat: {source === 'chat' ? 'Custom for this chat' : 'All chats default'}
    </p>
  );
};

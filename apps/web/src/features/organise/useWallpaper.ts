// The CSS for a chat's wallpaper id: built-in, from this device's gallery, or null (normal look).
import { useEffect, type CSSProperties } from 'react';
import { useCustomWallpapers, customWallpaperUrl } from './customWallpapers';
import { customWallpaperStyle, isCustomId, wallpaperStyle } from './wallpapers';

export interface ResolvedWallpaper {
  style: CSSProperties | null;
  /** A custom id whose picture is not on this device (it was set on another one). */
  missing: boolean;
}

export const useWallpaper = (id: string | null | undefined): ResolvedWallpaper => {
  const custom = isCustomId(id);
  const items = useCustomWallpapers((s) => s.items);
  const loaded = useCustomWallpapers((s) => s.loaded);
  const load = useCustomWallpapers((s) => s.load);
  useEffect(() => {
    if (custom) void load();
  }, [custom, load]);
  if (!id) return { style: null, missing: false };
  if (!custom) return { style: wallpaperStyle(id), missing: false };
  const url = customWallpaperUrl(items, id);
  return url
    ? { style: customWallpaperStyle(url), missing: false }
    : { style: null, missing: loaded };
};

// Wallpapers picked from the device gallery. The picture is shrunk, kept in IndexedDB on THIS
// device only, and the chat pref stores just its id ("custom:<uuid>"). On another device the
// picture is missing, so the chat shows the normal background.
import { create } from 'zustand';
import { openKv, type KvStore } from '@/lib/idb';
import { randomId } from '@/lib/ids';
import { decodeImage, looksLikeImage } from '../profile/decodeImage';
import { CUSTOM_PREFIX } from './wallpapers';

export const MAX_CUSTOM_WALLPAPERS = 10;
export const WALLPAPER_MAX_SIDE = 1600;
const QUALITY = 0.82;

interface CustomRecord {
  id: string;
  blob: Blob;
  createdAt: number;
}

export interface CustomWallpaper {
  id: string;
  url: string;
  createdAt: number;
}

let kv: KvStore<CustomRecord> | null = null;
const storage = (): KvStore<CustomRecord> =>
  (kv ??= openKv<CustomRecord>('flick-wallpapers', 'custom'));
/** Tests swap in a memory store (or null to reopen the real one). */
export const configureWallpaperStorage = (store: KvStore<CustomRecord> | null): void => {
  kv = store;
};

const toBlob = (canvas: HTMLCanvasElement, type: string): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob(resolve, type, QUALITY);
  });

/** Any picture the browser can decode becomes a JPEG (WebP where supported) of at most 1600px. */
export async function prepareWallpaper(file: File): Promise<Blob> {
  if (!looksLikeImage(file)) throw new Error('Pick a picture from your gallery.');
  let canvas = await decodeImage(file);
  const longest = Math.max(canvas.width, canvas.height);
  if (longest > WALLPAPER_MAX_SIDE) {
    const scale = WALLPAPER_MAX_SIDE / longest;
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(canvas.width * scale));
    small.height = Math.max(1, Math.round(canvas.height * scale));
    small.getContext('2d')?.drawImage(canvas, 0, 0, small.width, small.height);
    canvas = small;
  }
  const blob = (await toBlob(canvas, 'image/webp')) ?? (await toBlob(canvas, 'image/jpeg'));
  if (!blob) throw new Error('This browser could not prepare the picture.');
  return blob;
}

interface CustomState {
  items: CustomWallpaper[];
  loaded: boolean;
  load: () => Promise<void>;
  /** Saves a picture and returns its id. Rejects with a readable message. */
  add: (file: File) => Promise<string>;
  remove: (id: string) => Promise<void>;
}

const toItem = (r: CustomRecord): CustomWallpaper => ({
  id: r.id,
  createdAt: r.createdAt,
  url: URL.createObjectURL(r.blob),
});

const revoke = (items: CustomWallpaper[]): void => {
  for (const i of items) URL.revokeObjectURL(i.url);
};

let loading: Promise<void> | null = null;

export const useCustomWallpapers = create<CustomState>()((set, get) => ({
  items: [],
  loaded: false,
  load: () => {
    if (get().loaded) return Promise.resolve();
    loading ??= storage()
      .getAll()
      .then((records) => {
        revoke(get().items);
        set({
          items: records
            .filter((r) => r.id.startsWith(CUSTOM_PREFIX))
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(toItem),
          loaded: true,
        });
      })
      .catch(() => {
        set({ loaded: true });
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  },
  add: async (file) => {
    await get().load();
    if (get().items.length >= MAX_CUSTOM_WALLPAPERS) {
      throw new Error(
        `You can keep up to ${String(MAX_CUSTOM_WALLPAPERS)} custom wallpapers. Remove one first.`,
      );
    }
    const blob = await prepareWallpaper(file);
    const record: CustomRecord = {
      id: `${CUSTOM_PREFIX}${randomId()}`,
      blob,
      createdAt: Date.now(),
    };
    try {
      await storage().put(record.id, record);
    } catch {
      throw new Error('This browser could not save the wallpaper on this device.');
    }
    set((s) => ({ items: [toItem(record), ...s.items] }));
    return record.id;
  },
  remove: async (id) => {
    const gone = get().items.find((i) => i.id === id);
    await storage()
      .delete(id)
      .catch(() => undefined);
    if (gone) URL.revokeObjectURL(gone.url);
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  },
}));

/** Test helper: forget what was loaded. */
export const resetCustomWallpapers = (): void => {
  revoke(useCustomWallpapers.getState().items);
  loading = null;
  useCustomWallpapers.setState({ items: [], loaded: false });
};

export const customWallpaperUrl = (items: CustomWallpaper[], id: string): string | null =>
  items.find((i) => i.id === id)?.url ?? null;

// Sticker maker helpers: square-crop geometry and the "My stickers" store (IndexedDB).

/** The centred square of a width x height picture. */
export const squareCrop = (w: number, h: number): { sx: number; sy: number; size: number } => {
  const size = Math.min(w, h);
  return { sx: Math.round((w - size) / 2), sy: Math.round((h - size) / 2), size };
};

/** A photo as a rounded-corner transparent PNG, `px` wide. */
export async function makeSticker(file: Blob, px = 384): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const { sx, sy, size } = squareCrop(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.beginPath();
  ctx.roundRect(0, 0, px, px, px * 0.22);
  ctx.clip();
  ctx.drawImage(bmp, sx, sy, size, size, 0, 0, px, px);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Could not make the sticker'));
    }, 'image/png');
  });
}

export interface SavedSticker {
  id: string;
  blob: Blob;
}
const DB = 'flick-stickers';
const open = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('stickers', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB failed'));
    };
  });
const run = async <T>(
  mode: IDBTransactionMode,
  f: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = f(db.transaction('stickers', mode).objectStore('stickers'));
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB failed'));
    };
  });
};
export const saveSticker = async (blob: Blob): Promise<void> => {
  await run('readwrite', (s) => s.put({ id: crypto.randomUUID(), blob }));
};
export const listStickers = (): Promise<SavedSticker[]> =>
  run('readonly', (s) => s.getAll() as IDBRequest<SavedSticker[]>);
export const deleteSticker = async (id: string): Promise<void> => {
  await run('readwrite', (s) => s.delete(id));
};

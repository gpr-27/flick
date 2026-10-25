import { AVATAR_SIZE } from './avatarCrop';

/**
 * Turns the photo from the sign-in account into a square JPEG, the same kind of file the avatar
 * cropper produces, so it can go through the normal avatar upload.
 */
export async function squareJpegFromUrl(url: string): Promise<Blob> {
  const res = await fetch(url, { mode: 'cors', cache: 'no-store' });
  if (!res.ok) throw new Error(`The sign-in photo could not be loaded (${res.status}).`);
  const bitmap = await createImageBitmap(await res.blob());
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot prepare the photo.');
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.9);
    });
    if (!blob) throw new Error('The photo could not be prepared.');
    return blob;
  } finally {
    bitmap.close();
  }
}

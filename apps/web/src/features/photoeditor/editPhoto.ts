export type CropMode = 'free' | '1:1' | '4:3';

/** Files that already went through the editor (or were sent as the original): do not open it again. */
export const editedFiles = new WeakSet<File>();
/** Files the person chose to send as the original file, not as a compressed photo. */
export const sendAsFile = new WeakSet<File>();

/** Photo formats the editor can draw on a canvas. GIFs would lose their animation, so they skip it. */
export const isEditableImage = (file: { type: string }): boolean =>
  ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);

/** Largest centered rectangle of the given mode that fits in w x h. "free" keeps the whole image. */
export const cropRect = (
  w: number,
  h: number,
  mode: CropMode,
): { x: number; y: number; w: number; h: number } => {
  if (mode === 'free') return { x: 0, y: 0, w, h };
  const ratio = mode === '1:1' ? 1 : 4 / 3;
  let cw = w;
  let ch = w / ratio;
  if (ch > h) {
    ch = h;
    cw = h * ratio;
  }
  cw = Math.round(cw);
  ch = Math.round(ch);
  return { x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), w: cw, h: ch };
};

/** Draws the image rotated by `turns` quarter turns, then cropped, and returns it as a file. */
export const renderEdit = async (
  file: File,
  opts: { turns: number; mode: CropMode },
): Promise<File> => {
  const bitmap = await createImageBitmap(file);
  const odd = opts.turns % 2 !== 0;
  const rw = odd ? bitmap.height : bitmap.width;
  const rh = odd ? bitmap.width : bitmap.height;
  const rotated = document.createElement('canvas');
  rotated.width = rw;
  rotated.height = rh;
  const rc = rotated.getContext('2d');
  if (!rc) throw new Error('Canvas is not available');
  rc.translate(rw / 2, rh / 2);
  rc.rotate((opts.turns * Math.PI) / 2);
  rc.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  const box = cropRect(rw, rh, opts.mode);
  const out = document.createElement('canvas');
  out.width = box.w;
  out.height = box.h;
  out.getContext('2d')?.drawImage(rotated, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => {
    out.toBlob(resolve, type, 0.92);
  });
  if (!blob) throw new Error('Could not save the edited photo');
  return new File([blob], file.name, { type });
};

// Turns whatever picture the person picked into something the avatar cropper can draw: a canvas
// with the EXIF rotation applied and no side longer than MAX_SIDE. Anything the browser can decode
// works (JPEG, PNG, WebP, GIF, BMP, AVIF, and HEIC on Safari); the result is always re-encoded as
// JPEG by the cropper, so the API only ever sees a JPEG. Failures throw an error with a message
// that can be shown as it is.

export const MAX_SIDE = 2048;

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?|ico|svg)$/i;
const HEIC = /\.(heic|heif)$|^image\/hei[cf]/i;

/** Some browsers give no MIME type for HEIC and similar files, so the extension counts too. */
export const looksLikeImage = (file: Pick<File, 'type' | 'name'>): boolean =>
  file.type.startsWith('image/') || (file.type === '' && IMAGE_EXTENSIONS.test(file.name));

const isHeic = (file: Pick<File, 'type' | 'name'>): boolean =>
  HEIC.test(file.type) || HEIC.test(file.name);

const decodeMessage = (file: Pick<File, 'type' | 'name'>): string =>
  isHeic(file)
    ? "This browser can't open HEIC photos. Save or export the photo as JPEG or PNG, or take a new one, and try again."
    : "That file couldn't be read as a picture. Try a JPEG, PNG or WebP.";

const viaImageElement = async (file: Blob): Promise<HTMLImageElement> => {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode(); // browsers apply the EXIF rotation to <img> by default
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** Decodes `file`, rotates it upright and shrinks it to at most MAX_SIDE. */
export async function decodeImage(
  file: File,
  makeCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): Promise<HTMLCanvasElement> {
  let source: ImageBitmap | HTMLImageElement | null = null;
  if (typeof createImageBitmap === 'function') {
    try {
      source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      source = null; // try the <img> route below
    }
  }
  if (!source) {
    try {
      source = await viaImageElement(file);
    } catch {
      throw new Error(decodeMessage(file));
    }
  }
  try {
    const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
    const height = 'naturalHeight' in source ? source.naturalHeight : source.height;
    if (!width || !height) throw new Error(decodeMessage(file));
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const canvas = makeCanvas();
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot prepare the photo.');
    // JPEG has no transparency: paint white behind PNG / GIF / WebP with see-through parts.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    if ('close' in source) source.close();
  }
}

// Shrink a picked image before it is uploaded. Phone photos are often 4-8 MB; downscaling to a
// chat-sized JPEG (typically 150-400 KB) makes sending near-instant. Also reports the size in
// pixels, which the image message needs.

const MAX_DIMENSION = 1600;
const QUALITY = 0.82;
// Small files and animated GIFs are uploaded as-is.
const PASSTHROUGH_BYTES = 300 * 1024;

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

type Decoded = ImageBitmap | HTMLImageElement;

const loadImage = async (file: Blob): Promise<Decoded> => {
  if (typeof createImageBitmap === 'function') {
    try {
      // Honours EXIF orientation so phone photos aren't rotated.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall back to <img> decoding below
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const toJpegBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', QUALITY);
  });

export const prepareImage = async (file: File): Promise<PreparedImage> => {
  const source = await loadImage(file);
  const original = { blob: file as Blob, width: source.width, height: source.height };
  try {
    if (file.type === 'image/gif' || file.size <= PASSTHROUGH_BYTES) return original;

    const scale = Math.min(1, MAX_DIMENSION / Math.max(source.width, source.height));
    const width = Math.round(source.width * scale);
    const height = Math.round(source.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    // JPEG has no alpha: paint white behind transparent PNGs.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);

    const blob = await toJpegBlob(canvas);
    return blob && blob.size < file.size ? { blob, width, height } : original;
  } finally {
    if ('close' in source) source.close();
  }
};

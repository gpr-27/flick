// Crop a picked photo to a square, with zoom, using a plain canvas (no library).

export const AVATAR_SIZE = 512;
export const MAX_ZOOM = 3;

export interface CropView {
  /** 1 = the photo just covers the square. Up to MAX_ZOOM. */
  zoom: number;
  /** -1 (left or top edge) to 1 (right or bottom edge); 0 = centred. Only matters once zoomed in or for a wide photo. */
  panX: number;
  panY: number;
}

/**
 * Where to draw a photo of `width` x `height` on a square canvas of `size`, so that it covers the
 * canvas at zoom 1 and `pan` slides it over the part you want. Returns drawImage's x, y, w, h.
 */
export function cropRect(width: number, height: number, size: number, view: CropView) {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom));
  const scale = (size / Math.min(width, height)) * zoom;
  const w = width * scale;
  const h = height * scale;
  const clamp = (v: number) => Math.min(1, Math.max(-1, v));
  // How far the photo sticks out on each side, so a pan of -1 or 1 puts its edge on the square's.
  const x = (size - w) / 2 + clamp(view.panX) * ((w - size) / 2) * -1;
  const y = (size - h) / 2 + clamp(view.panY) * ((h - size) / 2) * -1;
  return { x, y, w, h };
}

/** Draws the cropped square on `canvas` (also used for the live preview). */
export function drawCrop(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource & { width: number; height: number },
  view: CropView,
  size = canvas.width,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { x, y, w, h } = cropRect(image.width, image.height, size, view);
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, x, y, w, h);
}

/** The cropped photo as a 512 x 512 JPEG. `makeCanvas` is a parameter so a test can pass a fake. */
export function cropToSquare(
  image: CanvasImageSource & { width: number; height: number },
  view: CropView,
  makeCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): Promise<Blob> {
  const canvas = makeCanvas();
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  drawCrop(canvas, image, view, AVATAR_SIZE);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not make the picture.'));
      },
      'image/jpeg',
      0.9,
    );
  });
}

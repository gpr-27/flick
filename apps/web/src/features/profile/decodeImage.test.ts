import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SIDE, decodeImage, looksLikeImage } from './decodeImage';

const fakeCanvas = () => {
  const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, ctx };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('looksLikeImage', () => {
  it('accepts image types and typeless HEIC / AVIF files', () => {
    expect(looksLikeImage({ type: 'image/png', name: 'a' })).toBe(true);
    expect(looksLikeImage({ type: '', name: 'IMG_1.HEIC' })).toBe(true);
    expect(looksLikeImage({ type: '', name: 'x.avif' })).toBe(true);
    expect(looksLikeImage({ type: 'application/pdf', name: 'x.pdf' })).toBe(false);
    expect(looksLikeImage({ type: '', name: 'notes.txt' })).toBe(false);
  });
});

describe('decodeImage', () => {
  it('downscales a large photo, asking the browser to apply its rotation', async () => {
    const close = vi.fn();
    const create = vi.fn(() => Promise.resolve({ width: 4096, height: 3072, close }));
    vi.stubGlobal('createImageBitmap', create);
    const { canvas, ctx } = fakeCanvas();
    const out = await decodeImage(
      new File(['x'], 'big.avif', { type: 'image/avif' }),
      () => canvas,
    );
    expect(create).toHaveBeenCalledWith(expect.anything(), { imageOrientation: 'from-image' });
    expect(out.width).toBe(MAX_SIDE);
    expect(out.height).toBe(1536);
    expect(ctx.drawImage).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('says plainly when a HEIC file cannot be opened', async () => {
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('nope')));
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        decode() {
          return Promise.reject(new Error('nope'));
        }
      },
    );
    await expect(
      decodeImage(new File(['x'], 'IMG_1.heic', { type: 'image/heic' })),
    ).rejects.toThrow(/HEIC/);
    await expect(decodeImage(new File(['x'], 'a.bin', { type: 'image/x-weird' }))).rejects.toThrow(
      /couldn't be read/,
    );
  });
});

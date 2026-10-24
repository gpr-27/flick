import { describe, expect, it, vi } from 'vitest';
import { AVATAR_SIZE, cropRect, cropToSquare } from './avatarCrop';
import {
  ABOUT_MAX,
  STATUS_PRESETS,
  completeness,
  copyText,
  profileLink,
  shareProfile,
  validateAbout,
  validateDisplayName,
  validateUsername,
} from './profileLogic';

describe('validation', () => {
  it('display name: 1 to 64 characters, spaces around do not count', () => {
    expect(validateDisplayName('')).not.toBeNull();
    expect(validateDisplayName('   ')).not.toBeNull();
    expect(validateDisplayName('A')).toBeNull();
    expect(validateDisplayName('x'.repeat(64))).toBeNull();
    expect(validateDisplayName('x'.repeat(65))).toMatch(/64/);
    expect(validateDisplayName(`  ${'x'.repeat(64)}  `)).toBeNull();
  });

  it('username: 3 to 32 of letters, digits, underscore and dot', () => {
    expect(validateUsername('ab')).toMatch(/at least 3/);
    expect(validateUsername('abc')).toBeNull();
    expect(validateUsername('A_b.9')).toBeNull();
    expect(validateUsername('x'.repeat(32))).toBeNull();
    expect(validateUsername('x'.repeat(33))).toMatch(/at most 32/);
    expect(validateUsername('no spaces')).toMatch(/Only letters/);
    expect(validateUsername('dash-ed')).toMatch(/Only letters/);
    expect(validateUsername('émile')).toMatch(/Only letters/);
  });

  it('about: up to 139 characters', () => {
    expect(ABOUT_MAX).toBe(139);
    expect(validateAbout('x'.repeat(139))).toBeNull();
    expect(validateAbout('x'.repeat(140))).toMatch(/139/);
  });

  it('has the seven status presets, each short enough for About', () => {
    expect(STATUS_PRESETS).toEqual([
      'Available',
      'Busy',
      'At school',
      'At work',
      'In a meeting',
      'Sleeping',
      'Only urgent calls',
    ]);
    for (const status of STATUS_PRESETS) expect(validateAbout(status)).toBeNull();
  });
});

describe('completeness meter', () => {
  const base = { display_name: 'sam', username: 'sam', about: null, avatar_url: null };
  it('counts photo, About and a name that is not just the username', () => {
    expect(completeness(base)).toMatchObject({
      percent: 0,
      photo: false,
      about: false,
      name: false,
    });
    expect(completeness({ ...base, avatar_url: 'https://x/y.png' }).percent).toBe(33);
    expect(completeness({ ...base, avatar_url: 'https://x/y.png', about: 'hi' }).percent).toBe(67);
    const full = completeness({
      display_name: 'Sam Rao',
      username: 'sam',
      about: 'hi',
      avatar_url: 'https://x/y.png',
    });
    expect(full.percent).toBe(100);
    expect(full.hint).toMatch(/complete/);
  });
  it('gives a friendly hint for the next step', () => {
    expect(completeness(base).hint).toMatch(/photo/);
    expect(completeness({ ...base, avatar_url: 'u' }).hint).toMatch(/About/);
    expect(completeness({ ...base, avatar_url: 'u', about: 'x' }).hint).toMatch(/name/);
  });
  it('a blank About does not count', () => {
    expect(completeness({ ...base, about: '   ' }).about).toBe(false);
  });
});

describe('sharing', () => {
  it('the link is origin + /u/ + username', () => {
    expect(profileLink('https://flick.app', 'sam')).toBe('https://flick.app/u/sam');
  });

  it('uses the share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    const result = await shareProfile('https://f/u/sam', 'Sam', {
      share,
      clipboard: { writeText },
    } as never);
    expect(result).toBe('shared');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://f/u/sam' }));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies the link when there is no share sheet (fallback)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(
      await shareProfile('https://f/u/sam', 'Sam', { clipboard: { writeText } } as never),
    ).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://f/u/sam');
  });

  it('copies when sharing fails, but respects a cancel', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const broken = vi.fn().mockRejectedValue(new Error('boom'));
    expect(
      await shareProfile('l', 'Sam', { share: broken, clipboard: { writeText } } as never),
    ).toBe('copied');
    const cancelled = vi.fn().mockRejectedValue(new DOMException('x', 'AbortError'));
    writeText.mockClear();
    expect(
      await shareProfile('l', 'Sam', { share: cancelled, clipboard: { writeText } } as never),
    ).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('reports a failure when nothing can copy', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    expect(await copyText('x', { clipboard: { writeText } } as never)).toBe('failed');
  });
});

describe('avatar crop', () => {
  it('a square photo at zoom 1 fills the square exactly', () => {
    expect(cropRect(400, 400, 512, { zoom: 1, panX: 0, panY: 0 })).toEqual({
      x: 0,
      y: 0,
      w: 512,
      h: 512,
    });
  });

  it('a wide photo is scaled to the short side and centred', () => {
    const r = cropRect(800, 400, 512, { zoom: 1, panX: 0, panY: 0 });
    expect(r.h).toBe(512);
    expect(r.w).toBe(1024);
    expect(r.x).toBe(-256);
  });

  it('zoom enlarges, and the pan moves the photo but never shows an empty edge', () => {
    const zoomed = cropRect(400, 400, 512, { zoom: 2, panX: 0, panY: 0 });
    expect(zoomed.w).toBe(1024);
    const left = cropRect(400, 400, 512, { zoom: 2, panX: -1, panY: 0 });
    const right = cropRect(400, 400, 512, { zoom: 2, panX: 1, panY: 0 });
    expect(left.x).toBe(0); // the photo's left edge is at the square's left edge
    expect(right.x + right.w).toBe(512); // and its right edge at the square's right edge
    // out of range values are clamped
    expect(cropRect(400, 400, 512, { zoom: 9, panX: 5, panY: -5 }).w).toBe(1536);
  });

  it('cropToSquare makes a 512 x 512 JPEG from the photo', async () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ clearRect: vi.fn(), drawImage }),
      toBlob: (cb: (b: Blob) => void, type: string) => {
        cb(new Blob(['jpeg'], { type }));
      },
    };
    const photo = { width: 800, height: 600 } as never;
    const blob = await cropToSquare(photo, { zoom: 1, panX: 0, panY: 0 }, () => canvas as never);
    expect(AVATAR_SIZE).toBe(512);
    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(512);
    expect(blob.type).toBe('image/jpeg');
    const [, x, y, w, h] = drawImage.mock.calls[0] as number[];
    expect(h).toBe(512);
    expect(w).toBeCloseTo(682.67, 1);
    expect(x).toBeCloseTo(-85.33, 1);
    expect(y).toBe(0);
  });

  it('fails when the canvas cannot make a picture', async () => {
    const canvas = {
      getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }),
      toBlob: (cb: (b: Blob | null) => void) => {
        cb(null);
      },
    };
    await expect(
      cropToSquare(
        { width: 1, height: 1 } as never,
        { zoom: 1, panX: 0, panY: 0 },
        () => canvas as never,
      ),
    ).rejects.toThrow();
  });
});

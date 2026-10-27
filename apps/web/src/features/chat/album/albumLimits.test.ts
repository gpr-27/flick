import { LIMITS } from '@chat/contracts';
import { describe, expect, it } from 'vitest';
import { trimPicked } from './albumLimits';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const files = (n: number, size = MB) =>
  Array.from({ length: n }, (_, i) => ({ name: `f${String(i)}.jpg`, size }));

describe('trimPicked', () => {
  it('keeps everything that fits and says nothing', () => {
    const r = trimPicked({ count: 0, bytes: 0 }, files(5));
    expect(r.accepted).toHaveLength(5);
    expect(r.notices).toEqual([]);
  });

  it('allows exactly the maximum number of items', () => {
    const r = trimPicked({ count: 0, bytes: 0 }, files(LIMITS.MAX_ALBUM_ITEMS));
    expect(r.accepted).toHaveLength(20);
    expect(r.notices).toEqual([]);
  });

  it('keeps the first 20 of 27 and explains with the numbers', () => {
    const picked = files(27);
    const r = trimPicked({ count: 0, bytes: 0 }, picked);
    expect(r.accepted).toEqual(picked.slice(0, 20));
    expect(r.notices).toEqual([
      'You can send up to 20 photos and videos at once (you picked 27) so uploads stay reliable. The first 20 were kept.',
    ]);
  });

  it('counts what the tray already holds', () => {
    const r = trimPicked({ count: 18, bytes: 0 }, files(5));
    expect(r.accepted).toHaveLength(2);
    expect(r.notices[0]).toContain('(you picked 23)');
    expect(r.notices[0]).toContain('Only 2 more fit');
    const full = trimPicked({ count: 20, bytes: 0 }, files(1));
    expect(full.accepted).toHaveLength(0);
    expect(full.notices[0]).toContain('nothing new was added');
  });

  it('keeps the first files that fit under the total size', () => {
    const picked = files(5, Math.floor(0.6 * GB)); // 3 GB in total
    const r = trimPicked({ count: 0, bytes: 0 }, picked);
    expect(r.accepted).toHaveLength(3); // 1.8 GB; the 4th would reach 2.4 GB
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]).toMatch(/add up to 3 GB; the limit for one send is 2 GB/);
    expect(r.notices[0]).toContain('The first 3 that fit were kept.');
  });

  it('reports the total as in the product copy (2.6 GB over a 2 GB limit)', () => {
    const r = trimPicked({ count: 0, bytes: 0 }, files(13, 0.2 * GB));
    expect(r.notices[0]).toContain('These files add up to 2.6 GB; the limit for one send is 2 GB');
  });

  it('rejects only the file over 1 GB, with the existing single-file message', () => {
    const big = { name: 'huge.mov', size: 1.5 * GB };
    const ok = files(2);
    const r = trimPicked({ count: 0, bytes: 0 }, [ok[0] as never, big, ok[1] as never]);
    expect(r.accepted).toHaveLength(2);
    expect(r.tooLarge).toHaveLength(1);
    expect(r.tooLarge[0]?.file).toBe(big);
    expect(r.notices[0]).toContain(
      'huge.mov: This file is 1.5 GB, but the limit is 1 GB per file.',
    );
    const single = trimPicked({ count: 0, bytes: 0 }, [big]);
    expect(single.notices[0]).toMatch(/^This file is 1.5 GB, but the limit is 1 GB per file\./);
  });
});

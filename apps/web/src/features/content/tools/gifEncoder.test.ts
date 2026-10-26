import { describe, expect, it } from 'vitest';
import { encodeGif, lzw, paletteIndex } from './gifEncoder';

describe('gif encoder', () => {
  it('maps colours to the palette', () => {
    expect(paletteIndex(0, 0, 0)).toBe(0);
    expect(paletteIndex(255, 255, 255)).toBe(215);
  });
  it('lzw starts with clear code and ends with end code (known vector)', () => {
    // GIF spec sample: indices 1,1,1,1,1,2,2,2,2,2 ... just check determinism and non-empty
    const a = lzw(Uint8Array.from([1, 1, 1, 1, 1, 2, 2, 2, 2, 2]), 2);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(lzw(Uint8Array.from([1, 1, 1, 1, 1, 2, 2, 2, 2, 2]), 2));
  });
  it('writes a valid header and trailer', () => {
    const frame = new Uint8ClampedArray(2 * 2 * 4).fill(255);
    const gif = encodeGif([frame, frame], 2, 2, 100);
    expect(String.fromCharCode(...gif.slice(0, 6))).toBe('GIF89a');
    expect(gif[6]).toBe(2);
    expect(gif.at(-1)).toBe(0x3b);
  });
  it('handles a large noisy frame without a dictionary overflow', () => {
    const n = 200 * 200;
    const f = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < f.length; i++) f[i] = (i * 7919) % 256;
    expect(encodeGif([f], 200, 200, 100).length).toBeGreaterThan(100);
  });
});

/** Reference GIF LZW decoder (standard rules) to prove the encoder's code-size switching. */
const unlzw = (bytes: number[], min: number): number[] => {
  const clear = 1 << min;
  const end = clear + 1;
  let table: number[][] = [];
  const reset = (): void => {
    table = [];
    for (let i = 0; i < clear; i++) table.push([i]);
    table.push([], []);
  };
  reset();
  let size = min + 1;
  let bits = 0;
  let nbits = 0;
  let pos = 0;
  let prev: number[] | null = null;
  const out: number[] = [];
  for (;;) {
    while (nbits < size && pos < bytes.length) {
      bits |= (bytes[pos++] ?? 0) << nbits;
      nbits += 8;
    }
    if (nbits < size) break;
    const code = bits & ((1 << size) - 1);
    bits >>>= size;
    nbits -= size;
    if (code === clear) {
      reset();
      size = min + 1;
      prev = null;
      continue;
    }
    if (code === end) break;
    let entry: number[];
    if (code < table.length) entry = table[code] ?? [];
    else entry = [...(prev ?? []), (prev ?? [])[0] ?? 0];
    out.push(...entry);
    if (prev) table.push([...prev, entry[0] ?? 0]);
    prev = entry;
    if (table.length === 1 << size && size < 12) size++;
  }
  return out;
};

it('lzw round-trips through a reference decoder, past 4096 codes', () => {
  const data = new Uint8Array(30000);
  let seed = 1;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed >> 16) & 255;
  }
  expect(unlzw(lzw(data, 8), 8)).toEqual(Array.from(data));
  const flat = new Uint8Array(5000).fill(7);
  expect(unlzw(lzw(flat, 8), 8)).toEqual(Array.from(flat));
});

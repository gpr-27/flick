// A small animated-GIF encoder (GIF89a). Colours are mapped to a fixed 216-colour palette
// (6 levels per channel) so there is no palette search; that is plenty for short clips.

/** Index 0-215 for an RGB colour on the 6x6x6 palette. */
export const paletteIndex = (r: number, g: number, b: number): number =>
  Math.round(r / 51) * 36 + Math.round(g / 51) * 6 + Math.round(b / 51);

/** Variable-width LZW as GIF wants it. Returns the packed bytes (without sub-block framing). */
export function lzw(indices: Uint8Array, minCodeSize: number): number[] {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out: number[] = [];
  let bits = 0;
  let nbits = 0;
  let size = minCodeSize + 1;
  const emit = (code: number): void => {
    bits |= code << nbits;
    nbits += size;
    while (nbits >= 8) {
      out.push(bits & 255);
      bits >>>= 8;
      nbits -= 8;
    }
  };
  let dict = new Map<number, number>();
  let next = end + 1;
  emit(clear);
  let prefix = indices[0] ?? 0;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i] ?? 0;
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next - 1 === 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      next = end + 1;
      size = minCodeSize + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (nbits > 0) out.push(bits & 255);
  return out;
}

/** RGBA frames (all width x height) to a looping GIF. delayMs per frame. */
export function encodeGif(
  frames: Uint8ClampedArray[],
  width: number,
  height: number,
  delayMs: number,
): Uint8Array {
  const out: number[] = [];
  const word = (n: number): void => {
    out.push(n & 255, (n >> 8) & 255);
  };
  out.push(...'GIF89a'.split('').map((c) => c.charCodeAt(0)));
  word(width);
  word(height);
  out.push(0xf7, 0, 0); // global palette of 256 entries, background 0
  for (let i = 0; i < 256; i++) {
    if (i < 216) out.push(Math.floor(i / 36) * 51, (Math.floor(i / 6) % 6) * 51, (i % 6) * 51);
    else out.push(0, 0, 0);
  }
  out.push(0x21, 0xff, 0x0b, ...'NETSCAPE2.0'.split('').map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  for (const rgba of frames) {
    const idx = new Uint8Array(width * height);
    for (let p = 0; p < idx.length; p++) {
      idx[p] = paletteIndex(rgba[p * 4] ?? 0, rgba[p * 4 + 1] ?? 0, rgba[p * 4 + 2] ?? 0);
    }
    out.push(0x21, 0xf9, 4, 0x04);
    word(Math.max(2, Math.round(delayMs / 10)));
    out.push(0, 0);
    out.push(0x2c);
    word(0);
    word(0);
    word(width);
    word(height);
    out.push(0, 8);
    const data = lzw(idx, 8);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      out.push(chunk.length, ...chunk);
    }
    out.push(0);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}

// Makes the baseline pictures in tests/e2e/screenshots-baseline smaller WITHOUT changing a single
// pixel: it decodes each PNG, tries all five PNG row filters for every row and keeps the one that
// compresses best, and deflates at the highest level. Playwright compares decoded pixels, so a
// smaller file is exactly as good a baseline.
//
//   node tests/e2e/optimise-baselines.mjs            optimise every baseline in place
//   node tests/e2e/optimise-baselines.mjs --check    only report sizes; exit 1 if one is over 150 KB
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), 'screenshots-baseline');
const LIMIT = 150 * 1024;
const check = process.argv.includes('--check');

const pngs = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? pngs(path) : entry.name.endsWith('.png') ? [path] : [];
  });

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
  return out;
};

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Undo the row filters of a decoded IDAT stream. */
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? out[y * stride + x - bpp] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const upLeft = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      const add = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][type];
      if (add === undefined) throw new Error(`bad filter type ${type}`);
      out[y * stride + x] = (row[x] + add) & 255;
    }
  }
  return out;
}

/** Filter every row with whichever of the five filters gives the smallest sum of absolute values. */
function refilter(pixels, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc((stride + 1) * height);
  const candidates = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < stride; x++) {
      const cur = pixels[y * stride + x];
      const left = x >= bpp ? pixels[y * stride + x - bpp] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = x >= bpp && y > 0 ? pixels[(y - 1) * stride + x - bpp] : 0;
      candidates[0][x] = cur;
      candidates[1][x] = (cur - left) & 255;
      candidates[2][x] = (cur - up) & 255;
      candidates[3][x] = (cur - ((left + up) >> 1)) & 255;
      candidates[4][x] = (cur - paeth(left, up, upLeft)) & 255;
    }
    let best = 0;
    let bestScore = Infinity;
    candidates.forEach((row, type) => {
      let score = 0;
      for (let x = 0; x < stride; x++) score += row[x] < 128 ? row[x] : 256 - row[x];
      if (score < bestScore) {
        bestScore = score;
        best = type;
      }
    });
    out[y * (stride + 1)] = best;
    candidates[best].copy(out, y * (stride + 1) + 1);
  }
  return out;
}

function optimise(file) {
  const data = readFileSync(file);
  let at = 8;
  let header;
  const idat = [];
  const others = [];
  while (at < data.length) {
    const length = data.readUInt32BE(at);
    const type = data.toString('ascii', at + 4, at + 8);
    const body = data.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type !== 'IEND') others.push(chunk(type, body));
    at += 12 + length;
  }
  if (!header) throw new Error(`${file}: no header`);
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const [depth, colour, , , interlace] = [header[8], header[9], header[10], header[11], header[12]];
  const bpp = { 2: 3, 6: 4 }[colour];
  if (depth !== 8 || !bpp || interlace !== 0) return null; // not a plain 8-bit RGB(A) picture
  const pixels = unfilter(inflateSync(Buffer.concat(idat)), width, height, bpp);
  const packed = deflateSync(refilter(pixels, width, height, bpp), { level: 9, memLevel: 9 });
  const png = Buffer.concat([
    data.subarray(0, 8),
    chunk('IHDR', header),
    ...others,
    chunk('IDAT', packed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png.length < data.length ? png : null;
}

let tooBig = 0;
for (const file of pngs(root)) {
  const before = statSync(file).size;
  if (!check) {
    const smaller = optimise(file);
    if (smaller) writeFileSync(file, smaller);
  }
  const after = statSync(file).size;
  const flag = after > LIMIT ? '  <-- over 150 KB' : '';
  if (after > LIMIT) tooBig++;
  console.log(
    `${resolve(file).replace(`${root}/`, '')}: ${(before / 1024).toFixed(0)} KB` +
      (check ? '' : ` -> ${(after / 1024).toFixed(0)} KB`) +
      flag,
  );
}
if (tooBig > 0) {
  console.error(`${tooBig} baseline(s) over 150 KB`);
  process.exit(1);
}

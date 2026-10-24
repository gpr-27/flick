// UUID v7 (RFC 9562): a 48-bit millisecond timestamp followed by random bits. IDs sort by
// creation time, so new rows land at the end of a B-tree index instead of on random pages.
//
// Within one millisecond we bump a 12-bit counter (the RFC's "method 1") so IDs from this
// process stay strictly increasing. If the clock steps backwards we keep the last timestamp.

let lastMs = -1;
let counter = 0;

export function uuidv7(now: number = Date.now()): string {
  const random = crypto.getRandomValues(new Uint8Array(10));
  if (now > lastMs) {
    lastMs = now;
    counter = ((random[0]! << 8) | random[1]!) & 0x7ff; // random start, leaves room to count up
  } else {
    counter++;
    if (counter > 0xfff) {
      lastMs++; // counter exhausted: borrow the next millisecond
      counter = 0;
    }
  }

  const bytes = new Uint8Array(16);
  let ms = lastMs;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = 0x70 | (counter >> 8); // version 7 + top 4 counter bits
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | (random[2]! & 0x3f); // RFC variant bits "10"
  bytes.set(random.subarray(3), 9);

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV7(value: string): boolean {
  return UUID_V7.test(value);
}

/** The creation time (Unix ms) stored in the first 48 bits of a UUID v7. */
export function uuidv7Time(id: string): number {
  return parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

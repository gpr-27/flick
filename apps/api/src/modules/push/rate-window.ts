/** "At most `max` calls per `windowMs` per key", kept in memory. take() says whether this call may go. */
export function createRateWindow(max: number, windowMs: number) {
  const calls = new Map<string, number[]>();
  return {
    take(key: string, now = Date.now()): boolean {
      const recent = (calls.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        calls.set(key, recent);
        return false;
      }
      recent.push(now);
      calls.set(key, recent);
      return true;
    },
  };
}

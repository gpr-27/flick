import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLIENT_PAYLOADS, SERVER_PAYLOADS } from '../src/index.js';

// Keeps docs/architecture/protocol.md honest: every example, tagged "```json client <event>" or
// "```json server <event>", must pass the real schema, and every event must be mentioned.
const doc = readFileSync(
  new URL('../../../docs/architecture/protocol.md', import.meta.url),
  'utf8',
);
const examples = [...doc.matchAll(/```json (client|server) (\w+)\n([\s\S]*?)\n```/g)].map((m) => ({
  side: m[1] as 'client' | 'server',
  event: m[2] ?? '',
  payload: JSON.parse(m[3] ?? '') as unknown,
}));

describe('protocol.md', () => {
  it('every example is a valid payload', () => {
    expect(examples.length).toBeGreaterThan(5);
    for (const { side, event, payload } of examples) {
      const schemas: Record<string, { safeParse(v: unknown): { success: boolean } }> =
        side === 'client' ? CLIENT_PAYLOADS : SERVER_PAYLOADS;
      expect(schemas[event], event).toBeDefined();
      expect(schemas[event]!.safeParse(payload).success, `${side} ${event}`).toBe(true);
    }
  });

  it('mentions every event', () => {
    for (const event of [...Object.keys(CLIENT_PAYLOADS), ...Object.keys(SERVER_PAYLOADS)])
      expect(doc, event).toContain(`\`${event}\``);
  });
});

import { describe, expect, it } from 'vitest';
import { serverDraftWins } from './useServerDraft';

describe('serverDraftWins', () => {
  const server = { body: 'from phone', updated_at: '2030-01-02T00:00:00Z' };
  it('uses the server draft when the box is empty', () => {
    expect(serverDraftWins(server, '', Date.parse('2030-06-01T00:00:00Z'))).toBe(true);
  });
  it('uses it only when newer than the local text', () => {
    expect(serverDraftWins(server, 'local', Date.parse('2030-01-01T00:00:00Z'))).toBe(true);
    expect(serverDraftWins(server, 'local', Date.parse('2030-01-03T00:00:00Z'))).toBe(false);
  });
  it('ignores no draft and identical text', () => {
    expect(serverDraftWins({ body: null, updated_at: null }, '', 0)).toBe(false);
    expect(serverDraftWins(server, 'from phone', 0)).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';

const call = vi.fn();
vi.mock('@/lib/services', () => ({ getApi: () => ({ call }) }));

import { syncPriorityContacts } from './quiet';

describe('syncPriorityContacts', () => {
  it('writes the chosen list into the server settings, keeping the other fields', async () => {
    const server = { digest: 'daily', quiet_enabled: true, priority_contacts: [] };
    call
      .mockResolvedValueOnce(server)
      .mockImplementationOnce((_e: unknown, o: { body: unknown }) => Promise.resolve(o.body));
    await syncPriorityContacts(['a', 'b']);
    const put = call.mock.calls[1]?.[1] as { body: Record<string, unknown> };
    expect(put.body).toEqual({ ...server, priority_contacts: ['a', 'b'] });
  });
});

import { describe, expect, it } from 'vitest';
import { createFakeClerk } from '../src/modules/auth/fake-clerk.js';

describe('fake clerk (test login)', () => {
  const clerk = createFakeClerk();

  it('accepts a fake token and gives the same id for the same name', async () => {
    expect(await clerk.verify('fake:alice')).toBe('fake_clerk_alice');
    expect(await clerk.verify('fake:alice')).toBe(await clerk.verify('fake:alice'));
  });

  it('rejects anything that is not a fake token', async () => {
    await expect(clerk.verify('eyJhbGciOi.real.clerk.token')).rejects.toThrow();
    await expect(clerk.verify('fake:')).rejects.toThrow();
    await expect(clerk.verify('fake:a b')).rejects.toThrow();
  });

  it('builds a profile from the name', async () => {
    expect(await clerk.profile('fake_clerk_alice')).toMatchObject({ username: 'alice' });
  });
});

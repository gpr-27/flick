import { describe, expect, it } from 'vitest';
import { emailAliasFor } from '../src/modules/platform/emailAlias.js';

describe('emailAliasFor', () => {
  it('builds username@domain when configured', () => {
    expect(emailAliasFor('Alice', 's', 'mail.flick.app')).toBe('alice@mail.flick.app');
    expect(emailAliasFor('bob', 's', '@mail.flick.app')).toBe('bob@mail.flick.app');
  });
  it('is hidden without the secret or the domain', () => {
    expect(emailAliasFor('alice', undefined, 'x.io')).toBeNull();
    expect(emailAliasFor('alice', 's', undefined)).toBeNull();
    expect(emailAliasFor('alice', 's', ' ')).toBeNull();
  });
  it('is hidden for a username the inbound handler could not match', () => {
    expect(emailAliasFor('al ice', 's', 'x.io')).toBeNull();
    expect(emailAliasFor(undefined, 's', 'x.io')).toBeNull();
  });
});

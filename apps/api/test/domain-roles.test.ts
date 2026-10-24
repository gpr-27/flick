import { describe, expect, it } from 'vitest';
import {
  canChangeRole,
  canEditInfo,
  canRemove,
  nextOwner,
} from '../src/modules/conversations/domain/roles.js';

describe('who may remove whom', () => {
  it('a member cannot remove anyone', () => {
    expect(canRemove('member', 'member')).toBe(false);
    expect(canRemove('member', 'admin')).toBe(false);
  });
  it('an admin removes members but not admins or the owner', () => {
    expect(canRemove('admin', 'member')).toBe(true);
    expect(canRemove('admin', 'admin')).toBe(false);
    expect(canRemove('admin', 'owner')).toBe(false);
  });
  it('the owner removes anyone else but cannot be removed', () => {
    expect(canRemove('owner', 'admin')).toBe(true);
    expect(canRemove('owner', 'member')).toBe(true);
    expect(canRemove('owner', 'owner')).toBe(false);
  });
});

describe('who may change roles', () => {
  it('an admin cannot demote the owner', () => {
    expect(canChangeRole('admin', 'owner', 'member')).toBe(false);
    expect(canChangeRole('admin', 'owner', 'admin')).toBe(false);
  });
  it('an admin can promote a member but not demote another admin', () => {
    expect(canChangeRole('admin', 'member', 'admin')).toBe(true);
    expect(canChangeRole('admin', 'admin', 'member')).toBe(false);
  });
  it('a member cannot promote; nobody makes a second owner', () => {
    expect(canChangeRole('member', 'member', 'admin')).toBe(false);
    expect(canChangeRole('owner', 'member', 'owner')).toBe(false);
  });
  it('the owner can demote an admin', () => {
    expect(canChangeRole('owner', 'admin', 'member')).toBe(true);
  });
});

describe('group info', () => {
  it('is open to members unless the group is admins-only', () => {
    expect(canEditInfo('member', false)).toBe(true);
    expect(canEditInfo('member', true)).toBe(false);
    expect(canEditInfo('admin', true)).toBe(true);
  });
});

describe('ownership transfer', () => {
  const at = (day: number) => new Date(2026, 0, day);
  it('prefers the oldest admin over an older member', () => {
    const heir = nextOwner([
      { userId: 'm', role: 'member', joinedAt: at(1) },
      { userId: 'a2', role: 'admin', joinedAt: at(5) },
      { userId: 'a1', role: 'admin', joinedAt: at(3) },
    ]);
    expect(heir).toBe('a1');
  });
  it('falls back to the oldest member, or nobody', () => {
    expect(
      nextOwner([
        { userId: 'new', role: 'member', joinedAt: at(9) },
        { userId: 'old', role: 'member', joinedAt: at(2) },
      ]),
    ).toBe('old');
    expect(nextOwner([])).toBeNull();
  });
});

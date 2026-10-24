// Who may do what in a conversation. Pure functions, so every rule is unit tested without a database.
import type { ConversationType, MemberRole } from '@chat/contracts';

export const isAdmin = (role: MemberRole) => role === 'owner' || role === 'admin';

/** Adding people, making invite links and deciding join requests. */
export const canManageMembers = isAdmin;

/** The owner can remove anyone else, an admin can remove plain members, a member can remove nobody. */
export function canRemove(actor: MemberRole, target: MemberRole): boolean {
  if (target === 'owner') return false;
  if (actor === 'owner') return true;
  return actor === 'admin' && target === 'member';
}

/**
 * Admins can promote members. Only the owner can demote an admin, and nobody changes the
 * owner's role or makes a second owner: ownership moves only when the owner leaves.
 */
export function canChangeRole(actor: MemberRole, target: MemberRole, newRole: MemberRole): boolean {
  if (target === 'owner' || newRole === 'owner' || target === newRole) return false;
  if (newRole === 'admin') return isAdmin(actor);
  return actor === 'owner'; // admin -> member
}

/** The group-wide switches (who can send, timer, approval) are for admins. */
export const canChangeSettings = isAdmin;

/** Name and picture: any member, unless the group is set to admins-only editing. */
export function canEditInfo(role: MemberRole, onlyAdminsEditInfo: boolean): boolean {
  return onlyAdminsEditInfo ? isAdmin(role) : true;
}

/** Direct chats have no name, picture or members; only the disappearing timer can be set. */
export const hasGroupFeatures = (type: ConversationType) => type === 'group';

interface Candidate {
  userId: string;
  role: MemberRole;
  joinedAt: Date;
}

/** When the owner leaves: the oldest admin takes over, otherwise the oldest member. */
export function nextOwner(remaining: Candidate[]): string | null {
  const oldest = (list: Candidate[]) =>
    [...list].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0];
  const heir = oldest(remaining.filter((m) => m.role === 'admin')) ?? oldest(remaining);
  return heir?.userId ?? null;
}

/** At most this many chats can be pinned. */
export const MAX_PINNED_CHATS = 3;

// Keeps Flick's profile and Clerk's account in step, so a name is edited in ONE place:
//
//   - Flick -> Clerk: after the Flick profile page saves, `pushProfileToClerk` copies the name
//     (and username, and photo) into the Clerk account. Flick is the source of truth.
//   - Clerk -> Flick: when the name or username changed in Clerk's own account menu,
//     `planClerkToFlick` says what to copy into Flick (see useClerkProfileSync).
//
// Each browser remembers the Clerk values it last saw in sync (`flick.clerkSync.v1`). Only a
// difference from that snapshot counts as "Clerk changed", so a name chosen in Flick is never
// overwritten by an unchanged Clerk account, and our own writes cannot start a loop.
import { ENDPOINTS } from '@chat/contracts';
import { notify } from '@/components/ui/notify';
import { ApiError } from '@/lib/api';
import { logger } from '@/lib/logger';
import { getApi } from '@/lib/services';
import { useSessionStore, type Me } from './useSessionStore';
import { DISPLAY_NAME_MAX, validateUsername } from '@/features/profile/profileLogic';

const STORAGE_KEY = 'flick.clerkSync.v1';

/** The parts of Clerk's user object we use (the real `UserResource` has more). */
export interface ClerkUserLike {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  update: (params: {
    firstName?: string;
    lastName?: string;
    username?: string;
  }) => Promise<ClerkUserLike | undefined>;
  setProfileImage?: (params: { file: Blob | null }) => Promise<unknown>;
}

/** The name and username as the two sides compare them. */
export interface Identity {
  name: string;
  username: string;
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The name Clerk shows: first and last name joined. */
export const clerkIdentity = (
  user: Pick<ClerkUserLike, 'firstName' | 'lastName' | 'username'>,
) => ({
  name: collapse(`${user.firstName ?? ''} ${user.lastName ?? ''}`),
  username: (user.username ?? '').toLowerCase(),
});

/** "Mary Ann Smith" becomes first "Mary", last "Ann Smith"; one word stays a first name. */
export const splitName = (displayName: string): { firstName: string; lastName: string } => {
  const name = collapse(displayName);
  const space = name.indexOf(' ');
  return space < 0
    ? { firstName: name, lastName: '' }
    : { firstName: name.slice(0, space), lastName: name.slice(space + 1) };
};

// ------------------------------------------------------------------ the remembered snapshot

type Snapshots = Record<string, Identity>;

const readAll = (storage: Pick<Storage, 'getItem'>): Snapshots => {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Snapshots) : {};
  } catch {
    return {};
  }
};

/** What Clerk looked like the last time it was in sync with this Flick user, or null. */
export const readSnapshot = (
  flickUserId: string,
  storage: Storage = localStorage,
): Identity | null => {
  const entry = readAll(storage)[flickUserId];
  return entry && typeof entry.name === 'string' && typeof entry.username === 'string'
    ? entry
    : null;
};

export const writeSnapshot = (
  flickUserId: string,
  identity: Identity,
  storage: Storage = localStorage,
): void => {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(storage), [flickUserId]: identity }));
  } catch {
    // Storage blocked: the next load takes a fresh snapshot, which is safe.
  }
};

// ------------------------------------------------------------------ Clerk -> Flick

export interface ClerkToFlickPlan {
  /** Fields to PATCH /users/me with; empty when there is nothing to copy. */
  patch: { display_name?: string; username?: string };
  /** True when there is no snapshot yet: remember Clerk as it is now and copy nothing. */
  firstRun: boolean;
}

/**
 * Decides what to copy from Clerk into Flick. Only a field that CHANGED in Clerk since the last
 * sync, and that differs from Flick's value, is copied; a blank name or an invalid username is not.
 */
export const planClerkToFlick = (
  clerk: Identity,
  flick: Identity,
  snapshot: Identity | null,
): ClerkToFlickPlan => {
  if (!snapshot) return { patch: {}, firstRun: true };
  const patch: ClerkToFlickPlan['patch'] = {};
  const name = clerk.name.slice(0, DISPLAY_NAME_MAX);
  if (clerk.name !== snapshot.name && name !== '' && name !== flick.name) {
    patch.display_name = name;
  }
  if (
    clerk.username !== snapshot.username &&
    clerk.username !== '' &&
    clerk.username !== flick.username.toLowerCase() &&
    validateUsername(clerk.username) === null
  ) {
    patch.username = clerk.username;
  }
  return { patch, firstRun: false };
};

// ------------------------------------------------------------------ Flick -> Clerk

/** The Clerk user, handed over by the component that can call `useUser()`. */
let clerkUser: ClerkUserLike | null = null;

export const setClerkUser = (user: ClerkUserLike | null): void => {
  clerkUser = user;
};

export type PushResult = 'ok' | 'skipped' | 'failed';

/**
 * Copies Flick's name, username and (optionally) photo into the Clerk account. Never throws: a
 * failure is logged and returned as 'failed' so the caller can show a small note while the Flick
 * save itself stays. 'skipped' means there is no Clerk user to update (not signed in with Clerk).
 */
export async function pushProfileToClerk(
  flickUserId: string,
  next: Identity & { photo?: Blob | null | undefined },
): Promise<PushResult> {
  const user = clerkUser;
  if (!user) return 'skipped';
  let failed = false;
  const current = clerkIdentity(user);
  const username = next.username.toLowerCase();
  const pushUsername = user.username !== null && username !== current.username;
  try {
    if (collapse(next.name) !== current.name) await user.update(splitName(next.name));
  } catch (error) {
    failed = true;
    logger.warn('Could not update the Clerk name', error);
  }
  // The username is its own call: a Clerk app without usernames refuses it, and that must not
  // undo the name.
  if (pushUsername) {
    try {
      await user.update({ username });
    } catch (error) {
      failed = true;
      logger.warn('Could not update the Clerk username', error);
    }
  }
  if (next.photo !== undefined && user.setProfileImage) {
    try {
      await user.setProfileImage({ file: next.photo });
    } catch (error) {
      failed = true;
      logger.warn('Could not update the Clerk photo', error);
    }
  }
  // Remember what Clerk holds now, so seeing our own change is not taken for an edit made in
  // Clerk. After a failure the old snapshot stays, which keeps Flick's choice safe.
  if (!failed) {
    writeSnapshot(flickUserId, {
      name: collapse(next.name),
      username: pushUsername ? username : current.username,
    });
  }
  return failed ? 'failed' : 'ok';
}

/**
 * Copies what changed in Clerk into Flick (PATCH /users/me) and remembers Clerk's values.
 * A username that is already taken on Flick keeps Flick's own, says why, and sets Clerk's back.
 * Any other failure leaves the snapshot alone and is only logged: nothing retries in a loop, the
 * next real change in Clerk tries again.
 */
export async function copyClerkToFlick(
  user: ClerkUserLike,
  flick: Me,
  patch: ClerkToFlickPlan['patch'],
): Promise<'done' | 'username-taken' | 'failed'> {
  const clerk = clerkIdentity(user);
  const call = (body: ClerkToFlickPlan['patch']) =>
    getApi().call(ENDPOINTS.users.updateMe, { body });
  try {
    const me = await call(patch);
    useSessionStore.getState().setUser(me);
    writeSnapshot(flick.id, clerk);
    return 'done';
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 409 && patch.username)) {
      logger.warn('Could not copy your account name into Flick', error);
      return 'failed';
    }
  }
  // The username is taken on Flick: keep Flick's, still copy the name, and tell the person why.
  notify.error(
    `The username @${patch.username} is already taken on Flick, so your Flick username stays @${flick.username}.`,
  );
  let username = clerk.username;
  try {
    if (patch.display_name) {
      useSessionStore.getState().setUser(await call({ display_name: patch.display_name }));
    }
    if (user.username !== null) {
      await user.update({ username: flick.username });
      username = flick.username.toLowerCase();
    }
  } catch (error) {
    logger.warn('Could not finish the account name sync', error);
  }
  writeSnapshot(flick.id, { name: clerk.name, username });
  return 'username-taken';
}

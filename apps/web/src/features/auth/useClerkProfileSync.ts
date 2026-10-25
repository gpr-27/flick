// Mounted once while signed in: hands the Clerk user to the Flick -> Clerk push, and copies a name
// or username changed in Clerk's own account menu into Flick (the rules are in clerkProfileSync).
import { useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { useSessionStore } from './useSessionStore';
import {
  clerkIdentity,
  copyClerkToFlick,
  planClerkToFlick,
  readSnapshot,
  setClerkUser,
  writeSnapshot,
  type ClerkUserLike,
} from './clerkProfileSync';

export const useClerkProfileSync = (): void => {
  const { isLoaded, user: clerkUser } = useUser();
  const flick = useSessionStore((s) => s.user);
  const busy = useRef(false);
  const [again, setAgain] = useState(0);
  // `UserResource` has everything ClerkUserLike needs; the narrow type keeps tests simple.
  const user = (clerkUser ?? null) as ClerkUserLike | null;

  useEffect(() => {
    setClerkUser(user);
    return () => {
      setClerkUser(null);
    };
  }, [user]);

  const clerkKey = user
    ? `${user.id}|${user.firstName ?? ''}|${user.lastName ?? ''}|${user.username ?? ''}`
    : '';

  useEffect(() => {
    if (!isLoaded || !user || !flick || busy.current) return;
    const clerk = clerkIdentity(user);
    const snapshot = readSnapshot(flick.id);
    const plan = planClerkToFlick(
      clerk,
      { name: flick.display_name, username: flick.username },
      snapshot,
    );
    if (plan.firstRun) {
      writeSnapshot(flick.id, clerk);
      return;
    }
    if (Object.keys(plan.patch).length === 0) {
      // Clerk and Flick already agree (or the change was not worth copying): just remember it.
      if (snapshot?.name !== clerk.name || snapshot.username !== clerk.username) {
        writeSnapshot(flick.id, clerk);
      }
      return;
    }
    busy.current = true;
    void copyClerkToFlick(user, flick, plan.patch).finally(() => {
      busy.current = false;
      setAgain((n) => n + 1); // a change that arrived meanwhile is looked at now
    });
    // `user` is read through clerkKey: its identity changes without its values changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, clerkKey, flick?.id, flick?.display_name, flick?.username, again]);
};

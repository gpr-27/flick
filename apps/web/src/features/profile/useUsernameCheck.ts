import { useEffect, useState } from 'react';
import { ENDPOINTS } from '@chat/contracts';
import { getApi } from '@/lib/services';
import { validateUsername } from './profileLogic';

export type UsernameStatus = 'same' | 'invalid' | 'checking' | 'available' | 'taken' | 'unknown';

export const USERNAME_DEBOUNCE_MS = 400;

/**
 * Is `username` free? Asks the server once the person has stopped typing for a moment.
 * 'same' = it is already yours; 'unknown' = the check itself failed (saving will still say).
 */
export function useUsernameCheck(username: string, current: string): UsernameStatus {
  const [result, setResult] = useState<{ name: string; status: UsernameStatus } | null>(null);
  const same = username.toLowerCase() === current.toLowerCase();
  const invalid = validateUsername(username) !== null;

  useEffect(() => {
    if (same || invalid) return;
    let stale = false;
    const timer = setTimeout(() => {
      getApi()
        .call(ENDPOINTS.users.usernameAvailable, { query: { u: username } })
        .then(
          (r) => {
            if (!stale) setResult({ name: username, status: r.available ? 'available' : 'taken' });
          },
          () => {
            if (!stale) setResult({ name: username, status: 'unknown' });
          },
        );
    }, USERNAME_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [username, same, invalid]);

  if (same) return 'same';
  if (invalid) return 'invalid';
  return result?.name === username ? result.status : 'checking';
}

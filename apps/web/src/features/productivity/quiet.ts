import { ENDPOINTS, isQuietNow, type ProductivitySettings } from '@chat/contracts';
import { getApi } from '@/lib/services';

// The server-side quiet hours (Settings > Notifications) also silence in-app sounds. The settings
// are fetched once, lazily; until they arrive nothing is silenced.
let current: ProductivitySettings | null = null;
let requested = false;

export const setQuietSettings = (s: ProductivitySettings): void => {
  current = s;
};

/** True while quiet hours are on and the sender is not a priority contact. */
export const serverQuiet = (senderId: string | null | undefined): boolean => {
  if (!requested) {
    requested = true;
    getApi()
      .call(ENDPOINTS.productivity.getSettings)
      .then(setQuietSettings, () => {
        requested = false;
      });
  }
  if (!current || !isQuietNow(current)) return false;
  return !(senderId && current.priority_contacts.includes(senderId));
};

/**
 * Copies the priority-contact list chosen in Settings > Notifications to the server, whose
 * quiet-hours check (the push worker) reads `priority_contacts` from the productivity settings.
 */
export const syncPriorityContacts = async (ids: string[]): Promise<void> => {
  const api = getApi();
  const server = await api.call(ENDPOINTS.productivity.getSettings);
  const saved = await api.call(ENDPOINTS.productivity.putSettings, {
    body: { ...server, priority_contacts: ids.slice(0, 50) },
  });
  setQuietSettings(saved);
};

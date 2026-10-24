// The caller's per-chat settings (archive, pin, mute, favourite, wallpaper, lock). Each change is
// one PATCH; the answer is the full prefs object, which we copy into the chat store.
import { ENDPOINTS, type ChatPrefs } from '@chat/contracts';
import { notify } from '@/components/ui/notify';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { useChatStore } from '../chat/useChatStore';

export const updatePrefs = async (
  conversationId: string,
  patch: Partial<ChatPrefs>,
): Promise<boolean> => {
  try {
    const prefs = await getApi().call(ENDPOINTS.conversations.updatePrefs, {
      params: { conversation_id: conversationId },
      body: patch,
    });
    useChatStore.setState((s) => {
      const c = s.conversations[conversationId];
      return c ? { conversations: { ...s.conversations, [conversationId]: { ...c, prefs } } } : s;
    });
    return true;
  } catch (error) {
    // e.g. "You can pin at most 3 chats" (409) comes straight from the server.
    notify.error(getErrorMessage(error, "Couldn't update this chat."));
    return false;
  }
};

const HOUR = 3_600_000;
export const MUTE_OPTIONS = [
  { id: '1h', label: '1 hour', ms: HOUR },
  { id: '8h', label: '8 hours', ms: 8 * HOUR },
  { id: '1w', label: '1 week', ms: 7 * 24 * HOUR },
  { id: 'always', label: 'Always', ms: null },
] as const;

/** "Always" is a date far in the future, so the server needs no special value. */
const ALWAYS = '2100-01-01T00:00:00.000Z';

export const mutedUntilFor = (ms: number | null, now = Date.now()): string =>
  ms === null ? ALWAYS : new Date(now + ms).toISOString();

export const isMuted = (prefs: ChatPrefs, now = Date.now()): boolean =>
  prefs.muted_until !== null && Date.parse(prefs.muted_until) > now;

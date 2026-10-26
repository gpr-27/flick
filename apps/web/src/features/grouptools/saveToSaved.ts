import { ENDPOINTS } from '@chat/contracts';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { getApi } from '@/lib/services';
import { sendMessage } from '../chat/outbox/useOutboxStore';

/** Saves text to your own Saved messages chat. */
export const saveToSaved = async (text: string): Promise<void> => {
  const myId = useSessionStore.getState().user?.id;
  if (!myId) return;
  const saved = await getApi().call(ENDPOINTS.conversations.openSaved);
  sendMessage(myId, saved.id, { type: 'text', text: text.slice(0, 60_000) });
};

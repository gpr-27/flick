// "Read offline": the last messages of recent chats (and the chat list) are copied to IndexedDB, so
// a chat still opens when the network is down. Only used as a fallback when a fetch fails; live
// data always wins. Falls back to memory where IndexedDB is unavailable (see lib/idb.ts).
import type { ConversationSummary, MessageRecord } from '@chat/contracts';
import { openKv } from '@/lib/idb';

const KEEP_MESSAGES = 50;
const KEEP_CHATS = 30;

interface Entry {
  id: string;
  savedAt: number;
  messages?: MessageRecord[];
  conversations?: ConversationSummary[];
}

// Without IndexedDB (private mode, tests) there is nothing to read back after a reload, so skip it.
const available = typeof indexedDB !== 'undefined';
const kv = openKv<Entry>('flick-offline', 'chats');
const LIST_ID = 'chat-list';

export async function cacheChat(
  conversationId: string,
  messages: readonly MessageRecord[],
): Promise<void> {
  if (!available) return;
  try {
    await kv.put(conversationId, {
      id: conversationId,
      savedAt: Date.now(),
      messages: messages.slice(-KEEP_MESSAGES),
    });
    const all = (await kv.getAll())
      .filter((e) => e.id !== LIST_ID)
      .sort((a, b) => b.savedAt - a.savedAt);
    for (const old of all.slice(KEEP_CHATS)) await kv.delete(old.id);
  } catch {
    // caching is best effort
  }
}

export async function readCachedChat(conversationId: string): Promise<MessageRecord[]> {
  if (!available) return [];
  try {
    return (await kv.getAll()).find((e) => e.id === conversationId)?.messages ?? [];
  } catch {
    return [];
  }
}

export async function cacheChatList(conversations: readonly ConversationSummary[]): Promise<void> {
  if (!available) return;
  try {
    await kv.put(LIST_ID, { id: LIST_ID, savedAt: Date.now(), conversations: [...conversations] });
  } catch {
    // best effort
  }
}

export async function readCachedChatList(): Promise<ConversationSummary[]> {
  if (!available) return [];
  try {
    return (await kv.getAll()).find((e) => e.id === LIST_ID)?.conversations ?? [];
  } catch {
    return [];
  }
}

/** For "Free up space" and sign-out. */
export async function clearCachedChats(): Promise<void> {
  if (!available) return;
  try {
    await kv.clear();
  } catch {
    // nothing to clear
  }
}

// "Apply to every chat": after the global wallpaper is set, clear the own wallpaper of every chat
// that has one, three requests at a time. Failures are collected, not thrown, so one bad chat
// does not stop the rest and the caller can say how many are left.
import { ENDPOINTS, type ConversationSummary } from '@chat/contracts';
import { getApi } from '@/lib/services';
import { useChatStore } from '../chat/useChatStore';

export const RESET_CONCURRENCY = 3;

/** Ids of the chats (direct, group, Saved messages, Flick) that have a wallpaper of their own. */
export const chatsWithOwnWallpaper = (
  conversations: Record<string, ConversationSummary>,
): string[] =>
  Object.values(conversations)
    .filter((c) => c.prefs.wallpaper)
    .map((c) => c.id);

export interface ResetResult {
  done: number;
  failed: string[];
}

export type ClearOne = (conversationId: string) => Promise<void>;

/** Clears one chat's wallpaper on the server and copies the answer into the chat store. */
export const clearChatWallpaper: ClearOne = async (conversationId) => {
  const prefs = await getApi().call(ENDPOINTS.conversations.updatePrefs, {
    params: { conversation_id: conversationId },
    body: { wallpaper: null },
  });
  useChatStore.setState((s) => {
    const c = s.conversations[conversationId];
    return c ? { conversations: { ...s.conversations, [conversationId]: { ...c, prefs } } } : s;
  });
};

export const resetChatWallpapers = async (
  ids: string[],
  opts: {
    clear?: ClearOne;
    concurrency?: number;
    onProgress?: (finished: number, total: number) => void;
  } = {},
): Promise<ResetResult> => {
  const clear = opts.clear ?? clearChatWallpaper;
  const workers = Math.max(1, opts.concurrency ?? RESET_CONCURRENCY);
  const failed: string[] = [];
  let next = 0;
  let finished = 0;
  const worker = async (): Promise<void> => {
    while (next < ids.length) {
      const id = ids[next++] as string;
      try {
        await clear(id);
      } catch {
        failed.push(id);
      }
      finished += 1;
      opts.onProgress?.(finished, ids.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, ids.length) }, worker));
  return { done: ids.length - failed.length, failed };
};

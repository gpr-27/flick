// Settings > Chats > "Default disappearing messages": a chat you start gets this timer.
import { ENDPOINTS, type ConversationSummary } from '@chat/contracts';
import { logger } from '@/lib/logger';
import { getApi } from '@/lib/services';
import { useSettingsStore } from './useSettingsStore';

/**
 * Sets the default timer on a chat that was just created. A chat that already has messages is
 * left alone (the person only asked for it on new chats). Failing is harmless: the chat simply
 * keeps no timer, and the person can set one from the chat menu.
 */
export async function applyDefaultTimer(summary: ConversationSummary): Promise<void> {
  const seconds = useSettingsStore.getState().defaultDisappearing;
  if (seconds === 0 || summary.last_message !== null) return;
  try {
    // Imported when needed: the chat store imports this file.
    const { useChatStore } = await import('@/features/chat/useChatStore');
    const updated = await getApi().call(ENDPOINTS.conversations.update, {
      params: { conversation_id: summary.id },
      body: { settings: { disappearing_timer_s: seconds } },
    });
    useChatStore.getState().conversationUpdated(summary.id, updated);
  } catch (error) {
    logger.warn('Could not set the default disappearing timer:', error);
  }
}

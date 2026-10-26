import { ENDPOINTS } from '@chat/contracts';
import { getApi } from '@/lib/services';

// Calls for the AI usage, privacy and speed controls.

export const usagePercent = (used: number, limit: number): number =>
  limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

const LABELS: Record<string, string> = {
  summarize: 'Summaries',
  'suggest-replies': 'Reply suggestions',
  translate: 'Translations',
  compose: 'Write with Flick',
  chat: 'Ask Flick',
  analyze: 'File analysis',
  transcribe: 'Voice transcripts',
  flick_bot: 'Flick in chats',
};
export const featureLabel = (feature: string): string =>
  LABELS[feature] ?? feature.replace(/[-_]/g, ' ');

export const getChatAiAllowed = async (conversationId: string): Promise<boolean> =>
  (await getApi().call(ENDPOINTS.ai.chatPrivacy, { params: { conversation_id: conversationId } }))
    .allow;

export const setChatAiAllowed = async (conversationId: string, allow: boolean): Promise<boolean> =>
  (
    await getApi().call(ENDPOINTS.ai.setChatPrivacy, {
      params: { conversation_id: conversationId },
      body: { allow },
    })
  ).allow;

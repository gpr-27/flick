import { ENDPOINTS, type TranscriptData } from '@chat/contracts';
import { getApi } from '@/lib/services';

// Calls for transcripts, auto-translate and the translation settings.
const E = ENDPOINTS.ai;

export const fetchTranscript = async (attachmentId: string): Promise<TranscriptData | null> =>
  (await getApi().call(E.transcript, { params: { attachment_id: attachmentId } })).transcript;

export const saveTranscriptEdit = async (attachmentId: string, text: string) =>
  (
    await getApi().call(E.editTranscript, {
      params: { attachment_id: attachmentId },
      body: { text },
    })
  ).transcript;

export const transcribeAttachment = async (attachmentId: string): Promise<string> =>
  (await getApi().call(E.transcribe, { body: { attachment_id: attachmentId } })).text;

export const getChatTranscribe = async (conversationId: string): Promise<boolean> =>
  (await getApi().call(E.chatTranscribe, { params: { conversation_id: conversationId } })).enabled;

export const setChatTranscribe = async (conversationId: string, enabled: boolean) =>
  (
    await getApi().call(E.setChatTranscribe, {
      params: { conversation_id: conversationId },
      body: { enabled },
    })
  ).enabled;

export const getTranslationSettings = () => getApi().call(E.translationSettings);

export const updateTranslationSettings = (body: {
  auto_transcribe?: boolean;
  dont_translate?: string[];
}) => getApi().call(E.updateTranslationSettings, { body });

/** Translates several texts at once into `language`; a text that failed comes back as null. */
export const translateBatch = async (
  items: { id: string; text: string }[],
  language: string,
  cache = true,
): Promise<Map<string, string | null>> => {
  const res = await getApi().call(E.translateBatch, {
    body: { items, target_language: language, cache },
  });
  return new Map(res.items.map((i) => [i.id, i.text]));
};

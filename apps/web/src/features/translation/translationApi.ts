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

/** `language` re-transcribes with that language ("it is really Telugu"); otherwise it is detected. */
export const transcribeAttachment = async (
  attachmentId: string,
  language?: string,
): Promise<string> =>
  (
    await getApi().call(E.transcribe, {
      body: { attachment_id: attachmentId, ...(language ? { language } : {}) },
    })
  ).text;

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
  cache: boolean,
  conversationId: string,
): Promise<Map<string, string | null>> => {
  const res = await getApi().call(E.translateBatch, {
    body: { items, target_language: language, cache, conversation_id: conversationId },
  });
  return new Map(res.items.map((i) => [i.id, i.text]));
};

/** The longest text one translate-batch item may carry (the contract allows 4,000 characters). */
const PIECE = 3_500;

/** Splits a long text into pieces under `max` characters, at paragraph, sentence or word ends. */
export const splitForTranslation = (text: string, max = PIECE): string[] => {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf('\n'), window.search(/[.!?।。](?=[^.!?।。]*$)/) + 1);
    if (cut < max / 2) cut = window.lastIndexOf(' ');
    if (cut < max / 2) cut = max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
};

/**
 * Translates a text of any length (a transcript can be long) into `language`. Returns null when
 * any piece failed: half a translation is worse than none.
 */
export const translateLong = async (
  text: string,
  language: string,
  conversationId: string,
): Promise<string | null> => {
  const pieces = splitForTranslation(text);
  if (pieces.length === 0) return null;
  const out = await translateBatch(
    pieces.map((p, i) => ({ id: `p${i}`, text: p })),
    language,
    false,
    conversationId,
  );
  const done = pieces.map((_, i) => out.get(`p${i}`) ?? null);
  return done.every((p) => p) ? done.join('\n') : null;
};

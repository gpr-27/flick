import { useState } from 'react';
import { ENDPOINTS, type AiAction } from '@chat/contracts';
import { getApi } from '@/lib/services';
import { composeText } from '../aiApi';

// Calls for the writing tools (style, "do it for me", plan, poll draft, study cards, dictation).

const E = ENDPOINTS.ai;

/** What the server needs to read "tomorrow 9am" in this person's time zone. */
export const clock = () => ({
  now: new Date().toISOString(),
  tz_offset_min: -new Date().getTimezoneOffset(),
});

export const planActions = (text: string) =>
  getApi().call(E.actions, { body: { text, ...clock() } });

export const makePlan = (text: string, conversationId?: string) =>
  getApi().call(E.plan, {
    body: { text, ...clock(), ...(conversationId ? { conversation_id: conversationId } : {}) },
  });

export const draftPoll = (text: string) => getApi().call(E.pollDraft, { body: { text } });

export const makeFlashcards = (source: { conversation_id: string } | { text: string }) =>
  getApi().call(E.flashcards, { body: source });

export const getStyleProfile = () => getApi().call(E.styleProfile);
export const refreshStyleProfile = () => getApi().call(E.refreshStyleProfile);
export const getChatStyle = (conversationId: string) =>
  getApi().call(E.chatStyle, { params: { conversation_id: conversationId } });
export const setChatStyle = (
  conversationId: string,
  body: { style: 'none' | 'formal' | 'casual' | 'friendly' | 'custom'; custom?: string | null },
) => getApi().call(E.setChatStyle, { params: { conversation_id: conversationId }, body });
export const getPersona = () => getApi().call(E.persona);
export const setPersona = (body: {
  persona: 'default' | 'concise' | 'friendly' | 'formal' | 'tutor';
  language?: string | null;
  level?: 'beginner' | 'intermediate' | 'advanced' | null;
}) => getApi().call(E.setPersona, { body });

/** Records go as base64 JSON; a short dictation is well under the limit. */
export async function dictate(blob: Blob, mime: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const res = await getApi().call(E.dictate, { body: { audio: btoa(binary), mime } });
  return res.text;
}

/** One-shot text tools on the compose endpoint. */
export const runTool = async (
  mode: 'simplify' | 'bullets' | 'bio' | 'code' | 'cleanup' | 'polish',
  text: string,
  signal?: AbortSignal,
): Promise<string> => (await composeText({ mode, text }, signal)).text;

export type { AiAction };

// ---- the "Suggest as I type" switch: off by default, per device ----
const GHOST_KEY = 'flick.ghostText';
export const readGhostSetting = (): boolean => {
  try {
    return localStorage.getItem(GHOST_KEY) === '1';
  } catch {
    return false;
  }
};
export const useGhostSetting = (): [boolean, (on: boolean) => void] => {
  const [on, setOn] = useState(readGhostSetting);
  return [
    on,
    (next) => {
      setOn(next);
      try {
        localStorage.setItem(GHOST_KEY, next ? '1' : '0');
      } catch {
        // storage blocked: the switch just will not be remembered
      }
    },
  ];
};

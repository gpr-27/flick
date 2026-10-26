// Drafts that follow you across devices: the composer text is saved to the server a moment after
// you stop typing, and the server copy is loaded when a chat opens if it is newer than this device's.
import { useEffect, useRef } from 'react';
import { ENDPOINTS } from '@chat/contracts';
import { getApi } from '@/lib/services';

const SAVE_DELAY_MS = 1000;
const stampKey = (id: string): string => `flick:draftAt:${id}`;

const localStamp = (id: string): number => {
  try {
    return Number(localStorage.getItem(stampKey(id))) || 0;
  } catch {
    return 0;
  }
};
const touchStamp = (id: string): void => {
  try {
    localStorage.setItem(stampKey(id), String(Date.now()));
  } catch {
    // Not fatal: the server copy just may win more often.
  }
};

/** True when the server draft should replace what the composer holds. Pure, so it is tested. */
export const serverDraftWins = (
  server: { body: string | null; updated_at: string | null },
  localText: string,
  localAt: number,
): server is { body: string; updated_at: string } =>
  typeof server.body === 'string' &&
  server.body !== '' &&
  server.body !== localText &&
  (localText === '' || Date.parse(server.updated_at ?? '') > localAt);

export const useServerDraft = (
  conversationId: string,
  text: string,
  setText: (text: string) => void,
  enabled: boolean,
): void => {
  const loaded = useRef(false);
  const synced = useRef<string | null>(null);
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getApi()
      .call(ENDPOINTS.drafts.get, { params: { conversation_id: conversationId } })
      .then((res) => {
        if (!alive) return;
        if (serverDraftWins(res, textRef.current, localStamp(conversationId))) {
          synced.current = res.body;
          setText(res.body);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        loaded.current = true;
      });
    return () => {
      alive = false;
    };
    // Once per chat: the composer remounts per conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, enabled]);

  useEffect(() => {
    if (!enabled || !loaded.current) return;
    const value = text.trim() ? text : '';
    if ((synced.current ?? '') === value) return;
    touchStamp(conversationId);
    const timer = setTimeout(() => {
      synced.current = value;
      const params = { conversation_id: conversationId };
      const request = value
        ? getApi().call(ENDPOINTS.drafts.put, { params, body: { body: value } })
        : getApi().call(ENDPOINTS.drafts.delete, { params });
      request.catch(() => {
        synced.current = null; // try again on the next change
      });
    }, SAVE_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [conversationId, text, enabled]);
};

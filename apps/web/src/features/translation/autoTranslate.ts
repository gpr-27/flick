import { useEffect, useState, useSyncExternalStore } from 'react';
import { ENDPOINTS } from '@chat/contracts';
import { getApi } from '@/lib/services';
import { detectLanguage } from '@/features/ai/languageDetect';
import { translateBatch } from './translationApi';

// Auto-translate for a chat: "translate this chat for me" is a per-reader setting, so in a group
// every reader sees the messages in their own language. Visible messages ask for their
// translation in one go (batched), and answers are kept so scrolling back costs nothing.

const targets = new Map<string, string | null>(); //          conversation id -> language or null
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

const loadTarget = (conversationId: string): void => {
  if (!conversationId || targets.has(conversationId) || loading.has(conversationId)) return;
  let request: Promise<{ target_language: string | null }>;
  try {
    request = getApi().call(ENDPOINTS.ai.autoTranslate, {
      params: { conversation_id: conversationId },
    });
  } catch {
    targets.set(conversationId, null);
    return;
  }
  const p = request
    .then((r) => {
      targets.set(conversationId, r.target_language);
    })
    .catch(() => {
      targets.set(conversationId, null);
    })
    .finally(() => {
      loading.delete(conversationId);
      emit();
    });
  loading.set(conversationId, p);
};

/** The language this chat is translated into for me, or null when auto-translate is off. */
export const useAutoTranslateTarget = (conversationId: string): string | null => {
  useEffect(() => {
    loadTarget(conversationId);
  }, [conversationId]);
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => targets.get(conversationId) ?? null,
  );
};

export const setAutoTranslateTarget = async (
  conversationId: string,
  language: string | null,
): Promise<void> => {
  const r = await getApi().call(ENDPOINTS.ai.setAutoTranslate, {
    params: { conversation_id: conversationId },
    body: { target_language: language },
  });
  targets.set(conversationId, r.target_language);
  emit();
};

// ---- batching ----
const done = new Map<string, string | null>(); //   `${language}:${message id}` -> translation
const waiting = new Map<
  string,
  { id: string; text: string; language: string; conversationId: string }
>();
const callbacks = new Map<string, Array<(text: string | null) => void>>();
let timer: ReturnType<typeof setTimeout> | undefined;
const BATCH = 20;

const flush = async (): Promise<void> => {
  timer = undefined;
  const all = [...waiting.entries()];
  waiting.clear();
  // One call per chat and language: each chat's own "AI off" switch applies to its texts.
  const groups = new Map<string, typeof all>();
  for (const entry of all) {
    const groupKey = `${entry[1].conversationId}\n${entry[1].language}`;
    const list = groups.get(groupKey) ?? [];
    list.push(entry);
    groups.set(groupKey, list);
  }
  for (const entries of groups.values()) {
    const first = entries[0];
    if (!first) continue;
    const { language, conversationId } = first[1];
    for (let i = 0; i < entries.length; i += BATCH) {
      const chunk = entries.slice(i, i + BATCH);
      let result = new Map<string, string | null>();
      try {
        result = await translateBatch(
          chunk.map(([, v]) => ({ id: v.id, text: v.text })),
          language,
          true,
          conversationId,
        );
      } catch {
        /* every one in this chunk falls back to "no translation" */
      }
      for (const [key, v] of chunk) {
        const text = result.get(v.id) ?? null;
        done.set(key, text);
        callbacks.get(key)?.forEach((cb) => cb(text));
        callbacks.delete(key);
      }
    }
  }
};

const request = (
  conversationId: string,
  id: string,
  text: string,
  language: string,
): Promise<string | null> => {
  const key = `${language}:${id}`;
  if (done.has(key)) return Promise.resolve(done.get(key) ?? null);
  return new Promise((resolve) => {
    callbacks.set(key, [...(callbacks.get(key) ?? []), resolve]);
    waiting.set(key, { id, text, language, conversationId });
    timer ??= setTimeout(() => void flush(), 150);
  });
};

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The translation of one incoming message, or null: auto-translate is off, the message is already
 * in my language, or the translation failed or came back unchanged.
 */
export const useAutoTranslation = (
  conversationId: string,
  messageId: string,
  text: string,
  enabled: boolean,
): { translated: string | null; pending: boolean } => {
  const language = useAutoTranslateTarget(conversationId);
  const skip = !enabled || !language || detectLanguage(text) === language;
  const key = language ? `${language}:${messageId}` : '';
  const [state, setState] = useState<{ key: string; text: string | null } | null>(null);

  useEffect(() => {
    if (skip || !language) return;
    let live = true;
    void request(conversationId, messageId, text, language).then((t) => {
      if (live) setState({ key, text: t });
    });
    return () => {
      live = false;
    };
  }, [skip, language, conversationId, messageId, text, key]);

  if (skip) return { translated: null, pending: false };
  if (state?.key !== key) return { translated: null, pending: true };
  return {
    translated: state.text && !same(state.text, text) ? state.text : null,
    pending: false,
  };
};

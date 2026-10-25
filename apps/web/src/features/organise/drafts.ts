// Unsent text per conversation: in memory for the UI, and in localStorage so a reload keeps it.
import { create } from 'zustand';
import { useSettingsStore } from '@/features/settings/useSettingsStore';

const KEY = 'flick:drafts';

const read = (): Record<string, string> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
};

const write = (drafts: Record<string, string>): void => {
  try {
    // Settings > Storage: with "Save drafts on this device" off they live in memory only.
    if (useSettingsStore.getState().saveDrafts) localStorage.setItem(KEY, JSON.stringify(drafts));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode or a full disk: the draft still lives in memory.
  }
};

interface DraftState {
  drafts: Record<string, string>;
  setDraft: (conversationId: string, text: string) => void;
}

export const useDraftStore = create<DraftState>()((set, get) => ({
  drafts: read(),
  setDraft: (conversationId, text) => {
    // Whitespace alone is not a draft.
    const value = text.trim() ? text : '';
    const { [conversationId]: old, ...rest } = get().drafts;
    if ((old ?? '') === value) return;
    const drafts = value ? { ...rest, [conversationId]: value } : rest;
    write(drafts);
    set({ drafts });
  },
}));

import { create } from 'zustand';
import type { FlickTopic } from '@chat/contracts';
import { listTopics, renameTopic, startTopic } from './flickApi';

interface TopicsState {
  topics: FlickTopic[];
  loaded: boolean;
  load: () => Promise<void>;
  start: (title?: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
}

/** Topics inside the Flick chat: a new topic is a fresh context (Flick sees only what follows). */
export const useFlickTopics = create<TopicsState>((set, get) => ({
  topics: [],
  loaded: false,
  load: async () => {
    try {
      set({ topics: await listTopics(), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  start: async (title) => {
    const topic = await startTopic(title);
    set({ topics: [topic, ...get().topics] });
  },
  rename: async (id, title) => {
    const topic = await renameTopic(id, title);
    set({ topics: get().topics.map((t) => (t.id === id ? topic : t)) });
  },
}));

/** The topic that begins between the previous message and this one (a divider goes above this one). */
export const topicStartingAt = (
  topics: readonly FlickTopic[],
  prevSeq: number,
  seq: number,
): FlickTopic | undefined =>
  topics.find((t) => t.started_message_seq > prevSeq && t.started_message_seq <= seq);

/** Topics matching a search, newest first. */
export const searchTopics = (topics: readonly FlickTopic[], query: string): FlickTopic[] => {
  const q = query.trim().toLowerCase();
  return q ? topics.filter((t) => t.title.toLowerCase().includes(q)) : [...topics];
};

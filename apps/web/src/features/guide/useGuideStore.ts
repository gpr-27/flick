// The guide's memory and its one-at-a-time queue.
//
// Progress (which topics were seen or used, whether the welcome tour is done, the on/off switch) is
// kept in localStorage under `flick.guide.v1`, so it is there the instant the app opens, and is
// synced with the server (GET/PATCH /users/me/guide) so it follows the person to other devices.
// The sync never blocks anything: changes are sent a moment later in one PATCH, and if the device is
// offline they wait and go out next time. The server only ever adds topics, and so do we.
import { create } from 'zustand';
import { ENDPOINTS, GUIDE_MAX_TOPICS } from '@chat/contracts';
import { logger } from '@/lib/logger';
import { getApi } from '@/lib/services';
import { getTopic } from './catalog';
import { guideAvailable } from './guideEnv';
import {
  EMPTY_STORED,
  earliest,
  hasExtra,
  readStored,
  unionTimes,
  type StoredGuide,
  type Times,
} from './progress';
import { isTipDue, nextTip } from './scheduler';

export const GUIDE_KEY = 'flick.guide.v1';
const SYNC_DELAY_MS = 1500;
const RETRY_DELAY_MS = 30_000;

export interface ActiveGuide {
  topicId: string;
  /** Index of the step on screen. */
  step: number;
  /** 'welcome' = the tour, 'tip' = shown by itself, 'replay' = the person asked to see it. */
  source: 'welcome' | 'tip' | 'replay';
}

export interface TickContext {
  now: number;
  /** A call, dialog or menu is in the way. */
  blocked: boolean;
  typing: boolean;
}

interface GuideStore extends StoredGuide {
  /** The server has answered (or could not be reached): it is now safe to decide who is "new". */
  settled: boolean;
  active: ActiveGuide | null;
  /** Tips waiting for their turn, oldest first. */
  queue: string[];
  lastTipAt: number;
  /** Tips wait while this is true (set by the host while a welcome tour is about to start). */
  holdTips: boolean;

  /** Use the saved progress of this account; a different account on this browser starts clean. */
  bindUser: (userId: string) => void;
  loadFromServer: () => Promise<void>;
  markUsed: (topicId: string) => void;
  markSeen: (topicId: string) => void;
  requestTip: (topicId: string) => void;
  cancelTip: (topicId: string) => void;
  /** Show the next queued tip if the rules allow. */
  tick: (context: TickContext) => void;
  startTopic: (topicId: string, options?: { step?: number }) => void;
  replay: (topicId: string) => void;
  next: () => void;
  back: () => void;
  /** Leave without finishing (Skip, Esc, outside click). The tour can be resumed. */
  close: () => void;
  /** Forget where the tour stopped (the "Resume tour" offer goes away). */
  dismissResume: () => void;
  setEnabled: (enabled: boolean) => void;
  reset: () => void;
  setHoldTips: (hold: boolean) => void;
}

const nowIso = (): string => new Date().toISOString();

/** Adds a topic to a list unless it is there already or the list is full. */
const withTopic = (times: Times, id: string): Times =>
  id in times || Object.keys(times).length >= GUIDE_MAX_TOPICS
    ? times
    : { ...times, [id]: nowIso() };

function readSaved(): StoredGuide {
  try {
    const text = localStorage.getItem(GUIDE_KEY);
    return text ? readStored(JSON.parse(text)) : { ...EMPTY_STORED };
  } catch {
    return { ...EMPTY_STORED };
  }
}

const STORED_FIELDS = [
  'userId',
  'seen',
  'used',
  'welcomeDoneAt',
  'enabled',
  'version',
  'resumeStep',
  'pendingReset',
  'enabledDirty',
  'dirty',
] as const;

function save(state: StoredGuide): void {
  try {
    const kept = Object.fromEntries(STORED_FIELDS.map((key) => [key, state[key]]));
    localStorage.setItem(GUIDE_KEY, JSON.stringify(kept));
  } catch {
    // storage blocked or full: the guide still works for this visit
  }
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncing = false;

export const useGuideStore = create<GuideStore>()((set, get) => {
  /** Applies a change, keeps this device's copy, and schedules the (quiet) trip to the server. */
  const change = (patch: Partial<GuideStore>, { sync = true }: { sync?: boolean } = {}): void => {
    set(sync ? { ...patch, dirty: true } : patch);
    save(get());
    if (sync) scheduleSync(SYNC_DELAY_MS);
  };

  const scheduleSync = (delay: number): void => {
    if (!guideAvailable()) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void flush();
    }, delay);
  };

  const flush = async (): Promise<void> => {
    const start = get();
    if (!guideAvailable() || syncing || !start.dirty || !start.userId) return;
    syncing = true;
    try {
      const saved = await getApi().call(ENDPOINTS.users.updateGuide, {
        body: {
          seen: start.seen,
          used: start.used,
          ...(start.welcomeDoneAt ? { welcome_done_at: start.welcomeDoneAt } : {}),
          ...(start.enabledDirty ? { enabled: start.enabled } : {}),
          ...(start.pendingReset ? { reset: true as const } : {}),
        },
      });
      const now = get();
      // Anything changed while the request was out stays dirty; the rest is in sync.
      const resetAgain = now.pendingReset && !start.pendingReset;
      const enabledAgain = now.enabledDirty && now.enabled !== start.enabled;
      const merged = {
        seen: unionTimes(saved.seen, now.seen),
        used: unionTimes(saved.used, now.used),
        welcomeDoneAt: earliest(saved.welcome_done_at, now.welcomeDoneAt),
      };
      const stillDirty =
        resetAgain ||
        enabledAgain ||
        hasExtra(merged, { ...saved, welcomeDoneAt: saved.welcome_done_at });
      change(
        {
          ...merged,
          version: saved.version,
          pendingReset: resetAgain,
          enabled: enabledAgain || now.enabledDirty ? now.enabled : saved.enabled,
          enabledDirty: enabledAgain,
          dirty: stillDirty,
        },
        { sync: false },
      );
      if (stillDirty) scheduleSync(SYNC_DELAY_MS);
    } catch (error) {
      // Offline or the server is down: keep the changes and try again later.
      logger.warn('Could not save the guide progress yet', error);
      scheduleSync(RETRY_DELAY_MS);
    } finally {
      syncing = false;
    }
  };

  const finishSession = (patch: Partial<GuideStore> = {}): void => {
    change({ ...patch, active: null, lastTipAt: Date.now() });
  };

  return {
    ...readSaved(),
    settled: false,
    active: null,
    queue: [],
    lastTipAt: 0,
    holdTips: false,

    bindUser: (userId) => {
      if (get().userId === userId) return;
      // Someone else used this browser before: their progress is not this person's.
      set({ ...EMPTY_STORED, userId, active: null, queue: [], settled: false });
      save(get());
    },

    loadFromServer: async () => {
      if (!guideAvailable()) {
        set({ settled: true });
        return;
      }
      try {
        const server = await getApi().call(ENDPOINTS.users.guide);
        const local = get();
        // A reset that has not reached the server yet wins over what the server still has.
        const merged = local.pendingReset
          ? { seen: local.seen, used: local.used, welcomeDoneAt: local.welcomeDoneAt }
          : {
              seen: unionTimes(server.seen, local.seen),
              used: unionTimes(server.used, local.used),
              welcomeDoneAt: earliest(server.welcome_done_at, local.welcomeDoneAt),
            };
        const needsSending =
          local.dirty ||
          local.pendingReset ||
          hasExtra(merged, { ...server, welcomeDoneAt: server.welcome_done_at });
        change(
          {
            ...merged,
            version: server.version,
            enabled: local.enabledDirty ? local.enabled : server.enabled,
            // The tour was finished on another device: nothing to resume here.
            resumeStep: merged.welcomeDoneAt && local.resumeStep === null ? null : local.resumeStep,
            dirty: needsSending,
            settled: true,
          },
          { sync: false },
        );
        if (needsSending) scheduleSync(SYNC_DELAY_MS);
      } catch (error) {
        // Offline: this device's copy is used, and the server hears about it later.
        logger.warn('Could not load the guide progress', error);
        set({ settled: true });
        if (get().dirty) scheduleSync(RETRY_DELAY_MS);
      }
    },

    markUsed: (topicId) => {
      if (!guideAvailable()) return;
      const s = get();
      const queue = s.queue.filter((id) => id !== topicId);
      if (topicId in s.used) {
        if (queue.length !== s.queue.length) set({ queue });
        return;
      }
      change({ used: withTopic(s.used, topicId), queue });
    },

    markSeen: (topicId) => {
      if (!guideAvailable()) return;
      const s = get();
      if (topicId in s.seen) return;
      change({ seen: withTopic(s.seen, topicId) });
    },

    requestTip: (topicId) => {
      const s = get();
      if (!guideAvailable() || !s.enabled) return;
      if (!isTipDue(topicId, s.seen, s.used)) return;
      if (s.active?.topicId === topicId || s.queue.includes(topicId)) return;
      set({ queue: [...s.queue, topicId] });
    },

    cancelTip: (topicId) => {
      const s = get();
      if (s.queue.includes(topicId)) set({ queue: s.queue.filter((id) => id !== topicId) });
    },

    tick: ({ now, blocked, typing }) => {
      const s = get();
      if (!guideAvailable()) return;
      const id = nextTip({
        queue: s.queue,
        seen: s.seen,
        used: s.used,
        enabled: s.enabled,
        busy: s.active !== null,
        blocked,
        typing,
        hold: s.holdTips || !s.settled,
        now,
        lastTipAt: s.lastTipAt,
      });
      if (!id) return;
      set({
        active: { topicId: id, step: 0, source: 'tip' },
        queue: s.queue.filter((q) => q !== id),
        lastTipAt: now,
      });
      // Shown once is enough: it is never queued again, not even after a reload.
      get().markSeen(id);
    },

    startTopic: (topicId, options) => {
      const topic = getTopic(topicId);
      if (!guideAvailable() || !topic) return;
      const step = Math.min(Math.max(options?.step ?? 0, 0), topic.steps.length - 1);
      const welcome = topic.trigger === 'welcome';
      set({
        active: { topicId, step, source: welcome ? 'welcome' : 'tip' },
        queue: get().queue.filter((id) => id !== topicId),
      });
      if (welcome) change({ resumeStep: step }, { sync: false });
      else get().markSeen(topicId);
    },

    replay: (topicId) => {
      const topic = getTopic(topicId);
      if (!guideAvailable() || !topic) return;
      get().startTopic(topicId);
      const active = get().active;
      if (active && active.source !== 'welcome') set({ active: { ...active, source: 'replay' } });
    },

    next: () => {
      const { active } = get();
      const topic = active && getTopic(active.topicId);
      if (!active || !topic) return;
      if (active.step >= topic.steps.length - 1) {
        // The last step's button: the tour is done.
        if (topic.trigger === 'welcome') {
          finishSession({
            welcomeDoneAt: get().welcomeDoneAt ?? nowIso(),
            // What the tour showed does not need a tip later.
            seen: [topic.id, ...(topic.covers ?? [])].reduce(withTopic, get().seen),
            resumeStep: null,
          });
        } else {
          finishSession({ seen: withTopic(get().seen, topic.id) });
        }
        return;
      }
      const step = active.step + 1;
      set({ active: { ...active, step } });
      if (topic.trigger === 'welcome') change({ resumeStep: step }, { sync: false });
    },

    back: () => {
      const { active } = get();
      const topic = active && getTopic(active.topicId);
      if (!active || !topic || active.step === 0) return;
      const step = active.step - 1;
      set({ active: { ...active, step } });
      if (topic.trigger === 'welcome') change({ resumeStep: step }, { sync: false });
    },

    close: () => {
      const { active } = get();
      const topic = active && getTopic(active.topicId);
      if (!active || !topic) return;
      if (topic.trigger === 'welcome') {
        const last = active.step >= topic.steps.length - 1;
        // Closing early counts as "dealt with" (it will not start by itself again), but the
        // person can pick it up where they stopped.
        finishSession({
          welcomeDoneAt: get().welcomeDoneAt ?? nowIso(),
          resumeStep: last ? null : active.step,
          ...(last ? { seen: withTopic(get().seen, topic.id) } : {}),
        });
      } else {
        finishSession({ seen: withTopic(get().seen, topic.id) });
      }
    },

    dismissResume: () => {
      change({ resumeStep: null }, { sync: false });
    },

    setEnabled: (enabled) => {
      change({ enabled, enabledDirty: true, ...(enabled ? {} : { queue: [], active: null }) });
    },

    reset: () => {
      change({
        seen: {},
        used: {},
        welcomeDoneAt: null,
        resumeStep: null,
        pendingReset: true,
        active: null,
        queue: [],
        lastTipAt: 0,
      });
    },

    setHoldTips: (hold) => {
      if (get().holdTips !== hold) set({ holdTips: hold });
    },
  };
});

/** The one call every feature makes when the person really uses it: it is never shown as a tip again. */
export const markUsed = (topicId: string): void => {
  useGuideStore.getState().markUsed(topicId);
};

/** Tests only: forget a pending sync timer. */
export function stopGuideSyncForTests(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = null;
  syncing = false;
}

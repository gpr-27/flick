// Who gets the welcome tour by itself, and who is only offered it.
//   - A NEW person (the account is less than a day old, or they have no real chats yet) is taken
//     through the tour once, automatically, when the chat list is ready.
//   - Someone who has been here a while is never forced: they see a small card in the chat list.
import type { ConversationSummary } from '@chat/contracts';
import { isFlickChat } from '@/features/ai/isFlickBot';
import { useChatStore } from '@/features/chat/useChatStore';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { WELCOME_ID } from './catalog';
import { guideAvailable } from './guideEnv';
import { useGuideStore } from './useGuideStore';

export const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000;
/** The "New here? Take a 1-minute tour" card was dismissed (a topic id, so it syncs too). */
export const WELCOME_CARD_ID = 'welcome.card';

export function isNewAccount(
  createdAt: string | undefined,
  conversations: readonly ConversationSummary[],
  now: number = Date.now(),
): boolean {
  const created = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (Number.isFinite(created) && now - created < NEW_ACCOUNT_MS) return true;
  // The saved-messages chat and the Flick assistant are there for everyone: they are not "activity".
  return !conversations.some((c) => !c.is_saved && !isFlickChat(c) && c.last_message);
}

/** The state the chat-list card and the host both need. */
export function useWelcomeState(): {
  /** Take the tour automatically (a new person who has not been through it). */
  autoStart: boolean;
  /** Show "New here? Take a 1-minute tour". */
  offer: boolean;
  /** Show "Resume tour". */
  resume: boolean;
} {
  const createdAt = useSessionStore((s) => s.user?.created_at);
  const conversations = useChatStore((s) => s.conversations);
  const listReady = useChatStore((s) => s.listStatus === 'ready');
  const g = useGuideStore();
  const none = { autoStart: false, offer: false, resume: false };
  if (!guideAvailable() || !g.enabled || !g.settled || !listReady) return none;
  if (g.resumeStep !== null) return { ...none, resume: true };
  if (g.welcomeDoneAt !== null) return none;
  const fresh = isNewAccount(createdAt, Object.values(conversations));
  if (fresh) return { ...none, autoStart: true };
  return { ...none, offer: !(WELCOME_CARD_ID in g.seen) };
}

export const startWelcome = (): void => {
  useGuideStore.getState().startTopic(WELCOME_ID);
};

export const resumeWelcome = (): void => {
  const { resumeStep, startTopic } = useGuideStore.getState();
  startTopic(WELCOME_ID, { step: resumeStep ?? 0 });
};

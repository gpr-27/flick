// Mounted once for a signed-in person. It runs the guide: loads the saved progress, starts the
// welcome tour for a new person, lets queued tips through when it is polite, moves the app to the
// right place for a tour step (a chat list, an open chat), and shows the overlay.
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useChatStore } from '@/features/chat/useChatStore';
import { useCallStore } from '@/features/calls/useCallStore';
import { useGroupCallStore } from '@/features/groupcall/useGroupCallStore';
import { callInProgress, layerOpen, typingNow, watchTyping } from './blockers';
import { getTopic } from './catalog';
import { inferUsedTopics } from './inferUsed';
import { GuideOverlay } from './GuideOverlay';
import { guideAvailable } from './guideEnv';
import { useGuideStore } from './useGuideStore';
import { startWelcome, useWelcomeState } from './welcomeRules';

const TICK_MS = 500;

export const GuideHost = () => {
  const userId = useSessionStore((s) => s.user?.id);
  const active = useGuideStore((s) => s.active);
  const welcome = useWelcomeState();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // A call (ringing, dialling or connected) silences the guide completely.
  const oneToOne = useCallStore((s) => s.callStatus !== 'idle');
  const group = useGroupCallStore(
    (s) => s.status === 'connected' || s.status === 'joining' || s.status === 'reconnecting',
  );
  const inCall = oneToOne || group;
  const callType = useCallStore((s) => s.callType);
  const conversations = useChatStore((s) => s.conversations);
  const listReady = useChatStore((s) => s.listStatus === 'ready');
  const settled = useGuideStore((s) => s.settled);

  // Load this person's progress (the saved copy is used at once; the server's is merged in).
  useEffect(() => {
    if (!userId || !guideAvailable()) return;
    useGuideStore.getState().bindUser(userId);
    void useGuideStore.getState().loadFromServer();
    // Back online: send what could not be sent and pick up changes from other devices.
    const onOnline = (): void => {
      void useGuideStore.getState().loadFromServer();
    };
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
    };
  }, [userId]);

  useEffect(() => watchTyping(), []);

  // What the person has clearly used already is never shown to them as new.
  useEffect(() => {
    if (!userId || !listReady || !settled) return;
    for (const id of inferUsedTopics(Object.values(conversations), userId)) {
      useGuideStore.getState().markUsed(id);
    }
  }, [userId, listReady, settled, conversations]);

  // Calls: using one counts as using it, and a tip about the call buttons waits until it is over
  // (the guide never speaks during a call).
  const wasInCall = useRef(false);
  useEffect(() => {
    const store = useGuideStore.getState();
    if (oneToOne && callType) store.markUsed(callType === 'video' ? 'calls.video' : 'calls.voice');
    if (group) store.markUsed('calls.group');
    if (inCall) wasInCall.current = true;
    else if (wasInCall.current) {
      wasInCall.current = false;
      store.requestTip('calls.controls');
    }
  }, [inCall, oneToOne, group, callType]);

  // While a new person's welcome tour is about to start, other tips wait for it.
  useEffect(() => {
    useGuideStore.getState().setHoldTips(welcome.autoStart);
  }, [welcome.autoStart]);

  // The heartbeat: start the welcome tour for a new person, or let one queued tip through.
  useEffect(() => {
    if (!userId || !guideAvailable()) return;
    const timer = window.setInterval(() => {
      const store = useGuideStore.getState();
      if (store.active || callInProgress()) return;
      if (welcome.autoStart && !layerOpen()) {
        startWelcome();
        return;
      }
      store.tick({ now: Date.now(), blocked: layerOpen(), typing: typingNow() });
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [userId, welcome.autoStart]);

  // A call began: a tip is dropped (the tour waits, below).
  useEffect(() => {
    const store = useGuideStore.getState();
    if (inCall && store.active && store.active.source !== 'welcome') store.close();
  }, [inCall]);

  // Put the app where this step expects it: the right page, a chat open or closed.
  const topicId = active?.topicId;
  const stepIndex = active?.step;
  // A tip belongs to the screen the person is on, so only a tour or a replay moves the app.
  const moves = active?.source !== 'tip';
  useEffect(() => {
    if (!topicId || stepIndex === undefined || !moves) return;
    const topic = getTopic(topicId);
    const step = topic?.steps[stepIndex];
    if (!topic || !step) return;
    const route = topic.route ?? '/';
    if (pathname !== route) {
      navigate(route);
      return;
    }
    const chat = useChatStore.getState();
    if (step.scene === 'chat' && !chat.selectedId) void chat.openSaved();
    else if (step.scene === 'list' && chat.selectedId) chat.select(null);
  }, [topicId, stepIndex, moves, pathname, navigate]);

  if (!active || inCall) return null;
  return <GuideOverlay key={active.topicId} />;
};

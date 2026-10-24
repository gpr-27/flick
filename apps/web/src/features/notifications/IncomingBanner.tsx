import { useEffect } from 'react';
import { useChatStore } from '../chat/useChatStore';
import { useIncomingBanner } from './bannerStore';

const SHOW_MS = 5_000;

/** A small tappable banner for a message that arrives in a chat that is not open. */
export const IncomingBanner = () => {
  const current = useIncomingBanner((s) => s.current);
  const dismiss = useIncomingBanner((s) => s.dismiss);

  // A newer message restarts the timer (current is a new object each time).
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(dismiss, SHOW_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [current, dismiss]);

  if (!current) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-4">
      <button
        type="button"
        className="glass-card pointer-events-auto w-full max-w-sm rounded-2xl px-4 py-3 text-left shadow-lg"
        onClick={() => {
          useChatStore.getState().select(current.conversationId);
          dismiss();
        }}
      >
        <span className="block truncate text-sm font-bold">{current.title}</span>
        <span className="block truncate text-sm text-base-content/70">{current.text}</span>
      </button>
    </div>
  );
};

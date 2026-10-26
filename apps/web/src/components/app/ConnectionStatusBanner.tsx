import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { Spinner, cn } from '@/components/ui';
import { useFeatureGuide } from '@/features/guide/useFeatureGuide';
import { useConnectionState } from '@/lib/realtime';
import { getTransport } from '@/lib/services';
import { useOutboxStore } from '@/features/chat/outbox/useOutboxStore';
import { RECONNECT_BANNER_DELAY_MS, bannerFor } from './connectionBanner';

/** App-wide offline / reconnecting banner driven by the realtime transport state. */
export const ConnectionStatusBanner = () => {
  const state = useConnectionState();
  const waiting = useOutboxStore((s) => s.items.filter((i) => i.status === 'pending').length);
  // "Reconnecting" waits out short blips so the banner doesn't flash; offline shows at once.
  const [delayElapsed, setDelayElapsed] = useState(false);

  useEffect(() => {
    if (state !== 'reconnecting') return;
    const timer = setTimeout(() => {
      setDelayElapsed(true);
    }, RECONNECT_BANNER_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setDelayElapsed(false);
    };
  }, [state]);

  const content = state === 'reconnecting' && !delayElapsed ? null : bannerFor(state, waiting);
  useFeatureGuide('net.offline', content?.tone === 'offline');

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(3.75rem+env(safe-area-inset-top))] z-50 flex justify-center px-4"
    >
      {content && (
        <div
          data-guide="net.banner"
          className={cn(
            'surface-raised pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold animate-fade-in-up',
            content.tone === 'offline' ? 'text-error' : 'text-base-content',
          )}
        >
          {content.tone === 'offline' ? (
            <WifiOff className="size-4" aria-hidden="true" />
          ) : (
            <Spinner label={null} />
          )}
          {content.text}
          {content.tone === 'offline' && waiting > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => {
                getTransport().connect();
              }}
            >
              Retry now
            </button>
          )}
        </div>
      )}
    </div>
  );
};

import { useEffect, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { useUpdateStore } from './update';

/** "A new version is ready": the user decides when to reload. */
export const UpdateBanner = () => {
  const updateReady = useUpdateStore((s) => s.updateReady);
  const applyUpdate = useUpdateStore((s) => s.applyUpdate);
  if (!updateReady) return null;
  return (
    <div
      role="status"
      className="glass-card fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[65] mx-auto flex max-w-sm items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg"
    >
      <span className="flex items-center gap-2">
        <RefreshCw className="size-4" aria-hidden="true" />A new version of Flick is available.
      </span>
      <button type="button" className="btn btn-primary btn-sm rounded-full" onClick={applyUpdate}>
        Reload
      </button>
    </div>
  );
};

/**
 * Shown from the browser's own online/offline signal. It works even when the signed-in app has
 * not loaded (Clerk needs the network), which is when the realtime connection banner cannot show.
 * It ignores pointer events: on a phone it sits over the chat header's back button, which must
 * stay usable while offline.
 */
export const OfflineNotice = () => {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = (): void => {
      setOnline(true);
    };
    const off = (): void => {
      setOnline(false);
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return (
    <div
      role="status"
      className="glass-card pointer-events-none fixed inset-x-4 top-[max(0.5rem,env(safe-area-inset-top))] z-[65] mx-auto flex max-w-sm items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-error shadow-lg"
    >
      <WifiOff className="size-4" aria-hidden="true" />
      You are offline. Flick will reconnect when you are back.
    </div>
  );
};

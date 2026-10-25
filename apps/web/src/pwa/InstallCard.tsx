import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { markUsed } from '@/features/guide/useGuideStore';
import { startInstall, useInstallMode } from './install';

const KEY = 'flick.install_card_dismissed_at';
const QUIET_DAYS = 14;

const dismissedRecently = (): boolean => {
  try {
    const at = Number(localStorage.getItem(KEY));
    return at > 0 && Date.now() - at < QUIET_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
};

/**
 * A small card at the top of the chat list, on phones only, offering to install Flick. Closing it
 * hides it for two weeks. The "Install app" entry in the menu stays available either way.
 */
export const InstallCard = () => {
  const mode = useInstallMode();
  const [hidden, setHidden] = useState(dismissedRecently);
  if (mode === 'none' || hidden) return null;

  const dismiss = (): void => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      // Storage blocked: it just comes back next visit.
    }
    setHidden(true);
  };

  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl bg-primary/10 p-3 sm:hidden">
      <Download className="size-5 shrink-0 text-primary" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm">Install Flick for a faster, full-screen app.</p>
      <button
        type="button"
        data-guide="install"
        onClick={() => {
          markUsed('install.app');
          void startInstall();
        }}
        className="btn btn-primary btn-sm h-10 min-h-10"
      >
        Install
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="btn btn-ghost btn-sm size-10 min-h-10 p-0"
        aria-label="Hide the install suggestion"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
};

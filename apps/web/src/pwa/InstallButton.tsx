import { Download } from 'lucide-react';
import { startInstall, useInstallMode } from './install';

/** Shown while Flick can be installed: the browser's dialog, or the steps where there is none. */
export const InstallButton = ({ className = '' }: { className?: string }) => {
  const mode = useInstallMode();
  if (mode === 'none') return null;
  return (
    <button
      type="button"
      onClick={() => void startInstall()}
      className={`btn btn-ghost btn-sm gap-2 rounded-full font-medium ${className}`}
    >
      <Download className="size-4" aria-hidden="true" />
      <span className="hidden sm:inline">Install app</span>
      <span className="sr-only sm:hidden">Install app</span>
    </button>
  );
};

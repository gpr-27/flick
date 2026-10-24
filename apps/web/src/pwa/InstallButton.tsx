import { Download } from 'lucide-react';
import { promptInstall, useInstallStore } from './install';

/** Shown only while the browser says the app can be installed. */
export const InstallButton = ({ className = '' }: { className?: string }) => {
  const canInstall = useInstallStore((s) => s.event !== null);
  if (!canInstall) return null;
  return (
    <button
      type="button"
      onClick={() => void promptInstall()}
      className={`btn btn-ghost btn-sm gap-2 rounded-full font-medium ${className}`}
    >
      <Download className="size-4" aria-hidden="true" />
      <span className="hidden sm:inline">Install app</span>
      <span className="sr-only sm:hidden">Install app</span>
    </button>
  );
};

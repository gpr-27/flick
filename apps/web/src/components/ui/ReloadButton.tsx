import { RefreshCw } from 'lucide-react';

/** "Reload" for media whose signed link expired; sized for a thumb. */
export const ReloadButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button
    type="button"
    onClick={onClick}
    className="btn btn-ghost btn-sm gap-1 rounded-full"
    aria-label={label}
  >
    <RefreshCw className="size-3.5" aria-hidden="true" />
    Reload
  </button>
);

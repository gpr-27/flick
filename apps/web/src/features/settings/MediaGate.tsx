import { Download } from 'lucide-react';

/** The button shown instead of the media while auto-download is off. */
export const TapToDownload = ({
  noun,
  onClick,
  className = '',
}: {
  /** "photo", "video" or "voice message". */
  noun: string;
  onClick: () => void;
  className?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex min-h-11 items-center gap-2 rounded-xl bg-black/10 px-3 py-2 text-sm font-semibold ${className}`}
  >
    <Download className="size-4" aria-hidden="true" />
    Download {noun}
  </button>
);

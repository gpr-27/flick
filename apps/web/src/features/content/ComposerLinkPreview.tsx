import { X } from 'lucide-react';
import { useSettingsStore } from '@/features/settings/useSettingsStore';
import { LinkPreviewCard } from './LinkPreviewCard';
import { firstUrl } from './urls';

/** The preview of the first link in the composer, with an X to send the message without it. */
export const ComposerLinkPreview = ({
  text,
  onDismiss,
}: {
  text: string;
  onDismiss: () => void;
}) => {
  const enabled = useSettingsStore((s) => s.linkPreviews);
  const url = firstUrl(text);
  if (!enabled || !url) return null;
  return (
    <div className="relative mb-2 max-w-sm">
      <LinkPreviewCard url={url} />
      <button
        type="button"
        onClick={onDismiss}
        className="btn btn-circle btn-xs absolute right-1 top-1 bg-base-100/80"
        aria-label="Remove link preview"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </div>
  );
};

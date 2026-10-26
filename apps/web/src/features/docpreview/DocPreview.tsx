import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { useAttachmentUrl } from '@/features/chat/content/attachments';
import { firstChunk, type PreviewKind } from './previewKind';

/** Dialog with an inline PDF, or the first ~2KB of a text file. */
export const DocPreview = ({
  attachmentId,
  fileName,
  kind,
  onClose,
}: {
  attachmentId: string;
  fileName: string;
  kind: Exclude<PreviewKind, null>;
  onClose: () => void;
}) => {
  const { url, failed } = useAttachmentUrl(attachmentId);
  const [text, setText] = useState<string | null>(null);
  const [textFailed, setTextFailed] = useState(false);

  useEffect(() => {
    if (kind !== 'text' || !url) return;
    let alive = true;
    fetch(url, { headers: { Range: 'bytes=0-4095' } })
      .then((res) => res.text())
      .then((t) => {
        if (alive) setText(firstChunk(t));
      })
      .catch(() => {
        if (alive) setTextFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [kind, url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${fileName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="flex h-[85vh] w-full max-w-3xl flex-col rounded-2xl bg-base-100 p-3 shadow-2xl">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="truncate font-semibold">{fileName}</p>
          <button
            type="button"
            className="btn btn-circle btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close preview"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-base-content/5">
          {failed || textFailed ? (
            <p role="alert" className="p-4 text-sm">
              Couldn&apos;t load a preview. Close this and tap the file to download it.
            </p>
          ) : !url ? (
            <Spinner size="sm" label="Loading preview" />
          ) : kind === 'pdf' ? (
            <object data={url} type="application/pdf" aria-label={fileName} className="size-full">
              <p className="p-4 text-sm">
                This browser can&apos;t show the PDF. Tap the file to download it.
              </p>
            </object>
          ) : text === null ? (
            <Spinner size="sm" label="Loading preview" />
          ) : (
            <pre className="whitespace-pre-wrap p-4 text-sm [overflow-wrap:anywhere]">{text}</pre>
          )}
        </div>
      </div>
    </div>
  );
};

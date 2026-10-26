import { useEffect, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';

/** Window event MessageInput listens to: detail is the dropped File. */
export const DROP_FILE_EVENT = 'flick:drop-file';

const hasFiles = (e: DragEvent): boolean =>
  Array.from(e.dataTransfer?.types ?? []).includes('Files');

/** "Drop to send" over the whole chat area while a file is dragged over the window. */
export const DropOverlay = () => {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setOver(true);
    };
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const reset = (): void => {
      depth.current = 0;
      setOver(false);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', reset);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', reset);
      window.removeEventListener('dragend', reset);
    };
  }, []);

  if (!over) return null;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) window.dispatchEvent(new CustomEvent(DROP_FILE_EVENT, { detail: file }));
      }}
      className="absolute inset-0 z-40 grid place-items-center bg-base-100/80 backdrop-blur-sm"
    >
      <div className="pointer-events-none flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary px-10 py-8 text-primary">
        <UploadCloud className="size-10" aria-hidden="true" />
        <p className="text-lg font-semibold">Drop to send</p>
      </div>
    </div>
  );
};

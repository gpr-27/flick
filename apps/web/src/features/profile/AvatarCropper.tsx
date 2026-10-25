import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui';
import { MAX_ZOOM, cropToSquare, drawCrop, type CropView } from './avatarCrop';

const PREVIEW = 256;

/** Pick the part of a photo to use: zoom and slide it under a square, then "Use photo". */
export const AvatarCropper = ({
  file,
  onCancel,
  onDone,
}: {
  /** The photo that was picked; null = closed. */
  file: File | null;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
}) => (
  <Modal
    open={file !== null}
    onClose={onCancel}
    labelledBy="crop-title"
    className="glass-card mx-4 w-full max-w-sm space-y-3 rounded-3xl p-6 animate-scale-in"
  >
    {/* Mounted only while open, so every photo starts with a fresh view. */}
    {file && <CropBody file={file} onCancel={onCancel} onDone={onDone} />}
  </Modal>
);

const CropBody = ({
  file,
  onCancel,
  onDone,
}: {
  file: File;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState<CropView>({ zoom: 1, panX: 0, panY: 0 });
  const [failed, setFailed] = useState(false);

  // Load the picked file as an image.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
    };
    img.onerror = () => {
      setFailed(true);
    };
    img.src = url;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // Redraw the preview whenever the view changes.
  useEffect(() => {
    if (image && canvasRef.current) drawCrop(canvasRef.current, image, view, PREVIEW);
  }, [image, view]);

  const slider = (label: string, key: keyof CropView, min: number, max: number, step: number) => (
    <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
      <span className="w-24 shrink-0">{label}</span>
      <input
        type="range"
        className="range range-primary range-sm min-h-11 flex-1"
        min={min}
        max={max}
        step={step}
        value={view[key]}
        aria-label={label}
        onChange={(e) => {
          setView({ ...view, [key]: Number(e.target.value) });
        }}
      />
    </label>
  );

  return (
    <>
      <h2 id="crop-title" className="font-display text-lg font-bold">
        Crop your photo
      </h2>
      {failed ? (
        <p role="alert" className="text-sm text-error">
          That file could not be read as a picture.
        </p>
      ) : (
        <canvas
          ref={canvasRef}
          width={PREVIEW}
          height={PREVIEW}
          aria-label="Photo preview"
          className="mx-auto size-64 rounded-full bg-base-content/10"
        />
      )}
      {slider('Zoom', 'zoom', 1, MAX_ZOOM, 0.05)}
      {slider('Left / right', 'panX', -1, 1, 0.05)}
      {slider('Up / down', 'panY', -1, 1, 0.05)}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost min-h-11 rounded-2xl" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary min-h-11 rounded-2xl"
          disabled={!image}
          onClick={() => {
            if (image) void cropToSquare(image, view).then(onDone);
          }}
        >
          Use photo
        </button>
      </div>
    </>
  );
};

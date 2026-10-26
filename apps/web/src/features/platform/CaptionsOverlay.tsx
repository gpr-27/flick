import { Captions } from 'lucide-react';
import { captionsSupported, useCaptions } from './captions';

/** The CC button and the other person's subtitles. Drop it inside a call overlay. */
export const CaptionsOverlay = () => {
  const enabled = useCaptions((s) => s.enabled);
  const theirs = useCaptions((s) => s.theirs);
  const setEnabled = useCaptions((s) => s.setEnabled);
  if (!captionsSupported()) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Live captions"
        aria-pressed={enabled}
        title={enabled ? 'Turn live captions off' : 'Turn live captions on'}
        onClick={() => {
          setEnabled(!enabled);
        }}
        className={`absolute right-3 top-3 z-10 grid size-11 place-items-center rounded-full backdrop-blur focus-visible:ring-2 focus-visible:ring-white ${
          enabled ? 'bg-white text-[#241f3d]' : 'bg-white/15 text-white hover:bg-white/25'
        }`}
      >
        <Captions className="size-5" aria-hidden="true" />
      </button>
      <div
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 bottom-32 flex justify-center px-4"
      >
        {theirs && (
          <p className="max-w-lg rounded-xl bg-black/70 px-3 py-2 text-center text-base text-white">
            {theirs}
          </p>
        )}
      </div>
    </>
  );
};

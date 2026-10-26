import { useState } from 'react';
import { Info } from 'lucide-react';
import { sourceLines, type AiSources } from './whySources';

/** "Why did Flick say this?": a small info popover listing what the reply was based on. */
export const WhyFlickSaid = ({ sources }: { sources: AiSources }) => {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        aria-label="Why did Flick say this?"
        aria-expanded={open}
        className="ml-1 inline-flex size-5 items-center justify-center rounded-full opacity-60 hover:opacity-100"
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <Info className="size-3.5" aria-hidden="true" />
      </button>
      {open && (
        <span
          role="note"
          className="absolute bottom-6 left-0 z-10 w-56 rounded-xl bg-[var(--bg-sunken)] p-3 text-xs text-[var(--text-1)] shadow-lg"
        >
          <span className="mb-1 block font-semibold">Flick used</span>
          <ul className="list-disc space-y-0.5 pl-4">
            {sourceLines(sources).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </span>
      )}
    </span>
  );
};

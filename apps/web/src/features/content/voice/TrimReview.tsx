import { useState } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { Waveform } from './VoicePlayer';
import { clampRange, sliceWaveform, type TrimRange } from './trim';
import type { Recording } from './useVoiceRecorder';

/** Review a finished recording: drag the two handles to cut the start and end, then send. */
export const TrimReview = ({
  recording,
  onSend,
  onDiscard,
}: {
  recording: Recording;
  onSend: (range: TrimRange) => void;
  onDiscard: () => void;
}) => {
  const [range, setRange] = useState<TrimRange>({ start: 0, end: 1 });
  const kept = sliceWaveform(recording.waveform, range);
  const seconds = ((range.end - range.start) * recording.durationMs) / 1000;
  return (
    <>
      <button
        type="button"
        onClick={onDiscard}
        className="btn btn-circle btn-ghost btn-sm"
        aria-label="Discard recording"
      >
        <Trash2 className="size-5" aria-hidden="true" />
      </button>
      <div className="relative min-w-0 flex-1">
        <Waveform samples={kept} progress={1} />
        <label className="sr-only" htmlFor="trim-start">
          Trim start
        </label>
        <input
          id="trim-start"
          type="range"
          min={0}
          max={100}
          value={Math.round(range.start * 100)}
          onChange={(e) => {
            setRange(clampRange({ start: Number(e.target.value) / 100, end: range.end }));
          }}
          className="range range-xs w-full"
        />
        <label className="sr-only" htmlFor="trim-end">
          Trim end
        </label>
        <input
          id="trim-end"
          type="range"
          min={0}
          max={100}
          value={Math.round(range.end * 100)}
          onChange={(e) => {
            setRange(clampRange({ start: range.start, end: Number(e.target.value) / 100 }));
          }}
          className="range range-xs w-full"
        />
      </div>
      <span className="font-mono text-sm">{seconds.toFixed(1)} s</span>
      <button
        type="button"
        onClick={() => {
          onSend(range);
        }}
        className="btn-grad grid size-11 place-items-center rounded-full"
        aria-label="Send trimmed voice message"
      >
        <Send className="size-5" aria-hidden="true" />
      </button>
    </>
  );
};

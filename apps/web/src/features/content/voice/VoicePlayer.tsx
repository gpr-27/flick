import { useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { ReloadButton, Spinner } from '@/components/ui';
import { useAttachmentUrl } from '@/features/chat/content/attachments';
import { TapToDownload } from '@/features/settings/MediaGate';
import { useMediaGate } from '@/features/settings/useMediaGate';
import { formatClock } from '../format';

const SPEEDS = [1, 1.5, 2] as const;

/** Bars from the waveform samples; fewer than 2 samples means "no waveform", so a plain bar. */
export const Waveform = ({
  samples,
  progress,
}: {
  samples: readonly number[];
  progress: number;
}) => {
  if (samples.length < 2) {
    return (
      <div className="h-1.5 flex-1 rounded-full bg-current/25" aria-hidden="true">
        <div className="h-full rounded-full bg-current" style={{ width: `${progress * 100}%` }} />
      </div>
    );
  }
  // A recording can have far more samples than fit: a bar is at least 2px wide with a 1px gap, so
  // draw at most BARS of them (averaged), and the bars can never be wider than the space they have.
  const bars = reduceBars(samples, BARS);
  const played = Math.round(progress * bars.length);
  return (
    <div
      className="flex h-8 w-full min-w-0 items-center gap-px"
      aria-hidden="true"
      data-testid="waveform"
    >
      {bars.map((level, i) => (
        <span
          key={i}
          className="min-w-0 flex-1 rounded-full bg-current"
          style={{ height: `${Math.max(12, level)}%`, opacity: i < played ? 1 : 0.35 }}
        />
      ))}
    </div>
  );
};

/** Most bars drawn in a voice note, so each stays a readable width on a phone. */
const BARS = 40;

/** Averages the samples down to `count` bars (or keeps them when there are fewer). */
const reduceBars = (samples: readonly number[], count: number): number[] => {
  if (samples.length <= count) return [...samples];
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i * samples.length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * samples.length) / count));
    const slice = samples.slice(from, to);
    return slice.reduce((sum, v) => sum + v, 0) / slice.length;
  });
};

export const VoicePlayer = ({
  attachmentId,
  durationMs,
  waveform,
}: {
  attachmentId: string;
  durationMs: number;
  waveform: readonly number[];
}) => {
  const gate = useMediaGate();
  const { url, failed, fail, reload } = useAttachmentUrl(attachmentId, gate.go);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  const toggle = (): void => {
    const el = audio.current;
    if (!el) return;
    if (playing) el.pause();
    else void el.play();
  };

  const cycleSpeed = (): void => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  };

  if (failed)
    return (
      <div className="flex items-center gap-2">
        <p className="text-sm italic opacity-70">Voice message unavailable</p>
        <ReloadButton onClick={reload} label="Reload voice message" />
      </div>
    );
  if (!gate.go) return <TapToDownload noun="voice message" onClick={gate.load} />;

  return (
    // Two rows, so nothing sits on top of anything else: the play button and the waveform, then
    // (under the waveform) the time on the left and the speed on the right.
    <div className="flex w-full min-w-0 max-w-64 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        {url ? (
          <button
            type="button"
            onClick={toggle}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-black/15"
            aria-label={playing ? 'Pause voice message' : 'Play voice message'}
          >
            {playing ? (
              <Pause className="size-4" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="grid size-10 shrink-0 place-items-center">
            <Spinner size="sm" label="Loading voice message" />
          </span>
        )}
        <div className="flex min-w-0 flex-1">
          <Waveform samples={waveform} progress={progress} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pl-12 text-xs">
        {/* While it plays, the time counts up; otherwise it is the length of the message. */}
        <span className="tabular-nums" aria-label="Voice message time">
          {formatClock(playing || progress > 0 ? Math.round(progress * durationMs) : durationMs)}
        </span>
        <button
          type="button"
          onClick={cycleSpeed}
          className="rounded-full bg-black/15 px-2.5 py-1 text-xs font-semibold tabular-nums"
          aria-label={`Playback speed ${speed}x. Change speed`}
        >
          {speed}x
        </button>
      </div>
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onError={fail}
          onPlay={(e) => {
            e.currentTarget.playbackRate = speed;
            setPlaying(true);
          }}
          onPause={() => {
            setPlaying(false);
          }}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
          onTimeUpdate={(e) => {
            const { currentTime, duration } = e.currentTarget;
            const total = Number.isFinite(duration) ? duration : durationMs / 1000;
            setProgress(total > 0 ? Math.min(1, currentTime / total) : 0);
          }}
        />
      )}
    </div>
  );
};

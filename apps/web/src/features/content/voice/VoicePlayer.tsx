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
  const played = Math.round(progress * samples.length);
  return (
    <div className="flex h-8 flex-1 items-center gap-px" aria-hidden="true" data-testid="waveform">
      {samples.map((level, i) => (
        <span
          key={i}
          className="w-[3px] flex-1 rounded-full bg-current"
          style={{ height: `${Math.max(12, level)}%`, opacity: i < played ? 1 : 0.35 }}
        />
      ))}
    </div>
  );
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
    // min-w-0 lets the waveform shrink, so the time and speed always keep their room on the right.
    <div className="flex w-full min-w-0 max-w-64 items-center gap-2">
      {url ? (
        <button
          type="button"
          onClick={toggle}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-black/15"
          aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        >
          {playing ? (
            <Pause className="size-4" aria-hidden="true" />
          ) : (
            <Play className="size-4" aria-hidden="true" />
          )}
        </button>
      ) : (
        <Spinner size="sm" label="Loading voice message" />
      )}
      <div className="flex min-w-0 flex-1">
        <Waveform samples={waveform} progress={progress} />
      </div>
      <span className="shrink-0 text-xs tabular-nums">{formatClock(durationMs)}</span>
      <button
        type="button"
        onClick={cycleSpeed}
        className="rounded-full bg-black/15 px-2 py-0.5 text-xs font-semibold"
        aria-label={`Playback speed ${speed}x. Change speed`}
      >
        {speed}x
      </button>
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

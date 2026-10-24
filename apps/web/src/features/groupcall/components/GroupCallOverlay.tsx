import { useEffect, useRef, type ReactNode } from 'react';
import { Mic, MicOff, PhoneOff, ScreenShare, ScreenShareOff, Video, VideoOff } from 'lucide-react';
import { cn, useFocusTrap } from '@/components/ui';
import { useGroupCallStore, type ParticipantTile } from '../useGroupCallStore';

const Tile = ({ tile }: { tile: ParticipantTile }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = tile.videoTrack ? new MediaStream([tile.videoTrack]) : null;
    if (tile.videoTrack) el.play().catch(() => undefined);
  }, [tile.videoTrack]);

  return (
    <li
      aria-label={`${tile.name}${tile.isLocal ? ' (you)' : ''}${tile.speaking ? ', speaking' : ''}`}
      data-speaking={tile.speaking}
      className={cn(
        'relative aspect-video overflow-hidden rounded-2xl bg-white/10 ring-2 transition-shadow',
        tile.speaking ? 'ring-success' : 'ring-transparent',
      )}
    >
      {tile.videoTrack ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={cn(
            'h-full w-full bg-black',
            tile.sharing ? 'object-contain' : 'object-cover',
            tile.isLocal && !tile.sharing && 'scale-x-[-1]',
          )}
        />
      ) : (
        <div className="grid h-full w-full place-items-center">
          <span className="grid size-16 place-items-center rounded-full bg-primary/40 font-display text-2xl text-white">
            {tile.name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      <span className="absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-xs text-white">
        {!tile.micOn && <MicOff className="size-3.5 shrink-0" aria-label="Muted" role="img" />}
        <span className="truncate">
          {tile.name}
          {tile.isLocal ? ' (you)' : ''}
        </span>
      </span>
    </li>
  );
};

const Control = ({
  label,
  onClick,
  active = false,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    aria-pressed={danger ? undefined : active}
    className={cn(
      'grid size-12 place-items-center rounded-full transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-white sm:size-14',
      danger
        ? 'bg-error text-error-content'
        : active
          ? 'bg-white text-[#241f3d]'
          : 'bg-white/15 text-white hover:bg-white/25',
    )}
  >
    {children}
  </button>
);

/** Full-screen group call: tiles, controls and the joining / reconnecting / error states. */
export const GroupCallOverlay = () => {
  const status = useGroupCallStore((s) => s.status);
  const error = useGroupCallStore((s) => s.error);
  const participants = useGroupCallStore((s) => s.participants);
  const micOn = useGroupCallStore((s) => s.micOn);
  const cameraOn = useGroupCallStore((s) => s.cameraOn);
  const sharing = useGroupCallStore((s) => s.sharing);
  const { leave, dismissError, toggleMic, toggleCamera, toggleScreenShare } =
    useGroupCallStore.getState();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, status !== 'idle');

  if (status === 'idle') return null;

  const canShare = 'mediaDevices' in navigator && 'getDisplayMedia' in navigator.mediaDevices;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Group call"
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex flex-col bg-gradient-to-br from-[#1b1830] via-[#241f3d] to-[#3a2540] text-white outline-none"
    >
      {status === 'error' ? (
        <div className="m-auto flex max-w-sm flex-col items-center gap-4 px-6 text-center">
          <p role="alert" className="text-lg">
            {error}
          </p>
          <button type="button" className="btn btn-primary rounded-full" onClick={dismissError}>
            Close
          </button>
        </div>
      ) : (
        <>
          <p role="status" aria-live="polite" className="py-3 text-center text-sm text-white/80">
            {status === 'joining'
              ? 'Joining the call…'
              : status === 'reconnecting'
                ? 'Connection lost. Reconnecting…'
                : `${participants.length} ${participants.length === 1 ? 'person' : 'people'} in the call`}
          </p>
          <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 content-center gap-3 overflow-y-auto px-4 sm:grid-cols-2 lg:grid-cols-3">
            {participants.map((p) => (
              <Tile key={p.identity} tile={p} />
            ))}
          </ul>
          <div className="flex justify-center gap-3 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
            <Control
              label={micOn ? 'Mute' : 'Unmute'}
              active={!micOn}
              onClick={() => void toggleMic()}
            >
              {micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
            </Control>
            <Control
              label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
              active={!cameraOn}
              onClick={() => void toggleCamera()}
            >
              {cameraOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}
            </Control>
            {canShare && (
              <Control
                label={sharing ? 'Stop sharing screen' : 'Share screen'}
                active={sharing}
                onClick={() => void toggleScreenShare()}
              >
                {sharing ? (
                  <ScreenShareOff className="size-5" />
                ) : (
                  <ScreenShare className="size-5" />
                )}
              </Control>
            )}
            <Control label="Leave call" danger onClick={leave}>
              <PhoneOff className="size-5" />
            </Control>
          </div>
        </>
      )}
    </div>
  );
};

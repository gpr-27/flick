import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Mic,
  MicOff,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Settings,
  Video,
  VideoOff,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { cn, useFocusTrap } from '@/components/ui';
import type { PeerSummary } from '@/types/domain';
import { useCallStore } from '../useCallStore';

type SinkableMedia = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };

// Picking the audio output device is only possible where HTMLMediaElement.setSinkId exists.
const canChooseSpeaker = typeof window !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

/**
 * Callback ref that attaches `stream` to a <video>/<audio> element and starts
 * playback. Its identity changes with the stream or `epoch`, so React calls it
 * again on (re)mount and after track changes. The callee receives tracks while
 * still ringing, before this overlay renders; binding on mount is what makes
 * the remote media show up. Re-assigning the same stream is needed on Safari.
 */
function useMediaRef(stream: MediaStream | null, epoch: number, extra?: unknown) {
  return useCallback(
    (el: HTMLMediaElement | null) => {
      if (!el) return;
      if (el.srcObject !== stream) el.srcObject = stream;
      else if (stream) {
        el.srcObject = null;
        el.srcObject = stream;
      }
      if (stream) el.play().catch(() => undefined);
    },
    // `epoch` / `extra` are deliberate re-bind triggers: a new callback identity
    // makes React re-run the ref with the same element after track changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream, epoch, extra],
  );
}

// getDisplayMedia is missing on most phones.
const canShareScreen = (): boolean =>
  typeof navigator !== 'undefined' &&
  'mediaDevices' in navigator &&
  'getDisplayMedia' in navigator.mediaDevices;

const CallAvatar = ({ user, className }: { user: PeerSummary | null; className?: string }) => (
  <div className={cn('overflow-hidden rounded-full shadow-2xl', className)} aria-hidden="true">
    {user?.avatar_url ? (
      <img
        src={user.avatar_url}
        alt=""
        onError={(e) => {
          e.currentTarget.onerror = null;
          e.currentTarget.src = '/avatar.png';
        }}
        className="h-full w-full object-cover"
      />
    ) : (
      <div className="grid h-full w-full place-items-center bg-primary/40 font-display text-4xl text-white">
        {user?.display_name.charAt(0) || '?'}
      </div>
    )}
  </div>
);

interface ControlButtonProps {
  onClick: () => void;
  label: string;
  active?: boolean;
  pressed?: boolean;
  variant?: 'default' | 'danger';
  children: ReactNode;
}

const ControlButton = ({
  onClick,
  label,
  active = false,
  pressed,
  variant = 'default',
  children,
}: ControlButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    aria-pressed={pressed}
    title={label}
    className={cn(
      'grid size-12 place-items-center rounded-full backdrop-blur transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-white sm:size-14',
      variant === 'danger'
        ? 'bg-error text-error-content shadow-lg hover:opacity-90'
        : active
          ? 'bg-white text-[#241f3d] shadow-lg'
          : 'bg-white/15 text-white hover:bg-white/25',
    )}
  >
    {children}
  </button>
);

interface DeviceSelectProps {
  label: string;
  icon: LucideIcon;
  value: string | null;
  options: readonly MediaDeviceInfo[];
  onChange: (deviceId: string) => void;
  placeholder?: string;
}

const DeviceSelect = ({
  label,
  icon: Icon,
  value,
  options,
  onChange,
  placeholder,
}: DeviceSelectProps) => (
  <label className="block">
    <span className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/70">
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
    <select
      value={value ?? ''}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/40 [&>option]:text-black"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((d, i) => (
        <option key={d.deviceId || i} value={d.deviceId}>
          {d.label || `${label} ${i + 1}`}
        </option>
      ))}
    </select>
  </label>
);

export const CallOverlay = () => {
  const callStatus = useCallStore((s) => s.callStatus);
  const callType = useCallStore((s) => s.callType);
  const otherUser = useCallStore((s) => s.otherUser);
  const localStream = useCallStore((s) => s.localStream);
  const remoteStream = useCallStore((s) => s.remoteStream);
  const isMuted = useCallStore((s) => s.isMuted);
  const isCameraOff = useCallStore((s) => s.isCameraOff);
  const isSharing = useCallStore((s) => s.isSharing);
  const screenStream = useCallStore((s) => s.screenStream);
  const failure = useCallStore((s) => s.failure);
  const streamEpoch = useCallStore((s) => s.streamEpoch);
  const remoteEpoch = useCallStore((s) => s.remoteEpoch);
  const connectionState = useCallStore((s) => s.connectionState);
  const devices = useCallStore((s) => s.devices);
  const audioInputId = useCallStore((s) => s.audioInputId);
  const audioOutputId = useCallStore((s) => s.audioOutputId);
  const videoInputId = useCallStore((s) => s.videoInputId);
  const {
    endCall,
    toggleMute,
    toggleCamera,
    startScreenShare,
    stopScreenShare,
    clearFailure,
    loadDevices,
    setAudioInput,
    setAudioOutput,
    setVideoInput,
  } = useCallStore.getState();

  const visible = callStatus === 'calling' || callStatus === 'connected';
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, visible);

  const remoteAudioRef = useRef<SinkableMedia | null>(null);
  const [showDevices, setShowDevices] = useState(false);

  const localVideoRef = useMediaRef(
    isSharing ? screenStream : localStream,
    streamEpoch,
    isCameraOff,
  );
  const remoteVideoRef = useMediaRef(remoteStream, remoteEpoch);
  const bindRemoteAudio = useMediaRef(remoteStream, remoteEpoch);
  const remoteAudioCallbackRef = useCallback(
    (el: HTMLAudioElement | null) => {
      remoteAudioRef.current = el;
      bindRemoteAudio(el);
    },
    [bindRemoteAudio],
  );

  // Mobile browsers sometimes block autoplay of remote audio: retry on the next
  // user interaction (always allowed).
  useEffect(() => {
    if (!remoteStream) return;
    const resume = (): void => {
      remoteAudioRef.current?.play().catch(() => undefined);
    };
    document.addEventListener('click', resume);
    document.addEventListener('touchend', resume);
    return () => {
      document.removeEventListener('click', resume);
      document.removeEventListener('touchend', resume);
    };
  }, [remoteStream]);

  // Route remote audio to the selected speaker.
  useEffect(() => {
    const el = remoteAudioRef.current;
    if (el && audioOutputId && typeof el.setSinkId === 'function') {
      el.setSinkId(audioOutputId).catch(() => undefined);
    }
  }, [audioOutputId, remoteStream, callStatus]);

  // Tidy the device panel when the call goes away.
  const [lastStatus, setLastStatus] = useState(callStatus);
  if (lastStatus !== callStatus) {
    setLastStatus(callStatus);
    if (callStatus === 'idle') setShowDevices(false);
  }

  if (!visible) {
    return failure ? (
      <div
        role="alert"
        className="fixed inset-x-4 top-20 z-[60] mx-auto flex max-w-sm items-center gap-3 rounded-2xl bg-error px-4 py-3 text-sm text-error-content shadow-xl"
      >
        <span className="flex-1">{failure}</span>
        <button type="button" className="btn btn-ghost btn-xs" onClick={clearFailure}>
          Dismiss
        </button>
      </div>
    ) : null;
  }

  const statusLabel =
    callStatus === 'calling'
      ? 'Calling…'
      : connectionState === 'reconnecting'
        ? 'Reconnecting…'
        : connectionState === 'connected'
          ? 'Connected'
          : 'Connecting…';
  const hasRemoteVideo = Boolean(
    remoteStream?.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted),
  );
  const showRemotePlaceholder = callType === 'video' && !hasRemoteVideo;
  const name = otherUser?.display_name ?? '';

  const toggleDevicePanel = (): void => {
    void loadDevices();
    setShowDevices((v) => !v);
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${callType === 'video' ? 'Video' : 'Voice'} call with ${name || 'contact'}`}
      tabIndex={-1}
      className="fixed inset-0 z-[60] animate-scale-in overflow-hidden outline-none"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[#1b1830] via-[#241f3d] to-[#3a2540]" />

      {/* Remote audio sink (always mounted; the remote <video> stays muted). */}
      <audio ref={remoteAudioCallbackRef} autoPlay className="hidden" />

      {callType === 'video' && (
        <>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 h-full w-full bg-black object-cover"
          />

          {showRemotePlaceholder && (
            <div className="absolute inset-0 flex animate-fade-in-up flex-col items-center justify-center gap-4 px-6 text-center">
              <CallAvatar
                user={otherUser}
                className="size-24 ring-4 ring-white/20 sm:size-28 md:size-32"
              />
              <p className="font-display text-xl text-white sm:text-2xl">{name}</p>
              <p className="text-sm tracking-wide text-white/70">{statusLabel}</p>
            </div>
          )}

          {/* Local PiP: top-right on phones (clears the controls), bottom-right on larger screens. */}
          <div className="absolute right-3 top-16 aspect-[3/4] w-24 overflow-hidden rounded-2xl shadow-xl ring-2 ring-white/20 sm:bottom-28 sm:right-4 sm:top-auto sm:w-32 md:w-40">
            {!isSharing && (isCameraOff || !localStream) ? (
              <div className="grid h-full w-full place-items-center bg-white/10 backdrop-blur">
                <VideoOff
                  className="size-7 text-white/50 sm:size-8"
                  aria-label="Your camera is off"
                  role="img"
                />
              </div>
            ) : (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                aria-label="Your camera"
                className="h-full w-full scale-x-[-1] object-cover"
              />
            )}
          </div>
        </>
      )}

      {callType === 'audio' && (
        <div className="absolute inset-0 flex animate-fade-in-up flex-col items-center justify-center gap-5 px-6 text-center">
          <CallAvatar
            user={otherUser}
            className="size-28 animate-pulse ring-4 ring-primary/50 sm:size-32 md:size-36"
          />
          <p className="font-display text-2xl text-white sm:text-3xl">{name}</p>
          <p className="text-sm tracking-wide text-white/70">{statusLabel}</p>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-5 flex justify-center px-4 sm:top-6">
        <span
          className="max-w-[90%] truncate text-xs uppercase tracking-widest text-white/80 sm:text-sm"
          role="status"
          aria-live="polite"
        >
          {name ? `${name} · ${statusLabel}` : statusLabel}
        </span>
      </div>

      {isSharing && (
        <div className="absolute inset-x-0 top-12 flex justify-center px-4">
          <div
            role="status"
            className="flex items-center gap-3 rounded-full bg-error px-4 py-2 text-sm text-error-content shadow-lg"
          >
            You are sharing your screen
            <button
              type="button"
              className="btn btn-xs rounded-full"
              onClick={() => void stopScreenShare()}
            >
              Stop sharing
            </button>
          </div>
        </div>
      )}

      {showDevices && (
        <div className="absolute inset-x-0 bottom-24 flex justify-center px-4 sm:bottom-28">
          <div
            className="glass-card max-h-[55vh] w-full max-w-sm space-y-3 overflow-y-auto rounded-2xl p-4"
            role="group"
            aria-label="Audio and video devices"
          >
            <DeviceSelect
              label="Microphone"
              icon={Mic}
              value={audioInputId}
              options={devices.mics}
              onChange={(id) => void setAudioInput(id)}
            />
            {callType === 'video' && (
              <DeviceSelect
                label="Camera"
                icon={Video}
                value={videoInputId}
                options={devices.cameras}
                onChange={(id) => void setVideoInput(id)}
              />
            )}
            {canChooseSpeaker ? (
              <DeviceSelect
                label="Speaker"
                icon={Volume2}
                value={audioOutputId}
                options={devices.speakers}
                onChange={setAudioOutput}
                placeholder="System default"
              />
            ) : (
              <p className="flex items-center gap-2 text-xs text-white/60">
                <Volume2 className="size-3.5" aria-hidden="true" />
                Speaker selection isn’t supported in this browser.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:gap-4">
        <ControlButton
          onClick={toggleMute}
          label={isMuted ? 'Unmute' : 'Mute'}
          active={isMuted}
          pressed={isMuted}
        >
          {isMuted ? (
            <MicOff className="size-5" aria-hidden="true" />
          ) : (
            <Mic className="size-5" aria-hidden="true" />
          )}
        </ControlButton>

        {callType === 'video' && (
          <ControlButton
            onClick={toggleCamera}
            label={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
            active={isCameraOff}
            pressed={isCameraOff}
          >
            {isCameraOff ? (
              <VideoOff className="size-5" aria-hidden="true" />
            ) : (
              <Video className="size-5" aria-hidden="true" />
            )}
          </ControlButton>
        )}

        {callType === 'video' && callStatus === 'connected' && canShareScreen() && (
          <ControlButton
            onClick={() => void (isSharing ? stopScreenShare() : startScreenShare())}
            label={isSharing ? 'Stop sharing screen' : 'Share screen'}
            active={isSharing}
            pressed={isSharing}
          >
            {isSharing ? (
              <ScreenShareOff className="size-5" aria-hidden="true" />
            ) : (
              <ScreenShare className="size-5" aria-hidden="true" />
            )}
          </ControlButton>
        )}

        <ControlButton
          onClick={toggleDevicePanel}
          label="Audio & video settings"
          active={showDevices}
          pressed={showDevices}
        >
          <Settings className="size-5" aria-hidden="true" />
        </ControlButton>

        <ControlButton onClick={endCall} label="End call" variant="danger">
          <PhoneOff className="size-5" aria-hidden="true" />
        </ControlButton>
      </div>
    </div>
  );
};

export default CallOverlay;

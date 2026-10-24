import { useRef } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { Avatar, Modal } from '@/components/ui';
import { useCallStore } from '../useCallStore';

export const IncomingCallModal = () => {
  const callStatus = useCallStore((s) => s.callStatus);
  const callType = useCallStore((s) => s.callType);
  const otherUser = useCallStore((s) => s.otherUser);
  const acceptRef = useRef<HTMLButtonElement>(null);

  const open = callStatus === 'ringing';
  const isVideo = callType === 'video';
  const callerName = otherUser?.display_name ?? 'Unknown';
  const { acceptCall, rejectCall } = useCallStore.getState();

  return (
    <Modal
      open={open}
      role="alertdialog"
      labelledBy="incoming-call-title"
      describedBy="incoming-call-desc"
      initialFocusRef={acceptRef}
      onClose={rejectCall}
      closeOnBackdrop={false}
      className="glass-card mx-4 w-full max-w-sm rounded-3xl p-8 text-center animate-scale-in"
    >
      <div className="relative mb-6 flex items-center justify-center" aria-hidden="true">
        <span className="absolute size-32 animate-ping rounded-full bg-primary/20" />
        <span className="absolute size-28 animate-pulse rounded-full bg-primary/15" />
        <Avatar
          src={otherUser?.avatar_url}
          name=""
          size="lg"
          className="z-10"
          imgClassName="relative shadow-lg ring-4 ring-primary/30"
        />
      </div>

      <h2
        id="incoming-call-title"
        className="mb-1 font-display text-2xl font-bold text-base-content"
      >
        {callerName}
      </h2>
      <p id="incoming-call-desc" className="mb-2 text-sm text-base-content/60">
        Incoming {isVideo ? 'video' : 'voice'} call…
      </p>

      <div className="mb-8 flex justify-center">
        <span className="chip flex items-center gap-1.5 text-xs">
          {isVideo ? (
            <Video className="size-3.5" aria-hidden="true" />
          ) : (
            <Phone className="size-3.5" aria-hidden="true" />
          )}
          {isVideo ? 'Video' : 'Voice'}
        </span>
      </div>

      <div className="flex items-end justify-center gap-10">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={rejectCall}
            aria-label="Decline call"
            className="grid size-14 place-items-center rounded-full bg-error text-error-content shadow-lg transition-transform hover:opacity-90 active:scale-95"
          >
            <PhoneOff className="size-6" aria-hidden="true" />
          </button>
          <span className="text-xs text-base-content/60" aria-hidden="true">
            Decline
          </span>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            ref={acceptRef}
            type="button"
            onClick={() => void acceptCall()}
            aria-label="Accept call"
            className="grid size-14 animate-bounce place-items-center rounded-full bg-success text-success-content shadow-lg transition-transform hover:opacity-90 active:scale-95"
          >
            {isVideo ? (
              <Video className="size-6" aria-hidden="true" />
            ) : (
              <Phone className="size-6" aria-hidden="true" />
            )}
          </button>
          <span className="text-xs text-base-content/60" aria-hidden="true">
            Accept
          </span>
        </div>
      </div>
    </Modal>
  );
};

export default IncomingCallModal;

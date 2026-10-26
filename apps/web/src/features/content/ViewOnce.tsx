// View-once: the recipient taps to open, the server records it, the content shows once, then it
// is gone. The server stops sending the content to this user after the open (content = null).
import { useEffect, useState, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { ENDPOINTS } from '@chat/contracts';
import { notify } from '@/components/ui';
import { getErrorMessage, isApiError } from '@/lib/api';
import { getApi } from '@/lib/services';

/** Opened in this tab: the virtual list can remount a bubble, and it must stay "Opened". */
const openedHere = new Set<string>();

export const OpenedPlaceholder = () => (
  <p className="flex items-center gap-2 text-sm italic opacity-70">
    <EyeOff className="size-4" aria-hidden="true" />
    Opened
  </p>
);

export const ViewOnce = ({
  conversationId,
  messageId,
  isMine,
  noun,
  children,
}: {
  conversationId: string;
  messageId: string;
  isMine: boolean;
  /** "photo", "video" or "voice message", for the labels. */
  noun: string;
  children: ReactNode;
}) => {
  const [phase, setPhase] = useState<'closed' | 'viewing' | 'opened'>(
    openedHere.has(messageId) ? 'opened' : 'closed',
  );
  const [busy, setBusy] = useState(false);
  // Protection: the content is blurred while the tab is hidden or the window loses focus.
  const [away, setAway] = useState(false);
  useEffect(() => {
    const check = (): void => {
      setAway(document.hidden || !document.hasFocus());
    };
    window.addEventListener('blur', check);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('blur', check);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  if (isMine) {
    return (
      <div>
        <p className="mb-1 flex items-center gap-1 text-xs font-semibold opacity-80">
          <Eye className="size-3.5" aria-hidden="true" />
          View once
        </p>
        {children}
      </div>
    );
  }

  const open = async (): Promise<void> => {
    setBusy(true);
    try {
      await getApi().call(ENDPOINTS.messages.openViewOnce, {
        params: { conversation_id: conversationId, message_id: messageId },
      });
      openedHere.add(messageId);
      setPhase('viewing');
    } catch (error) {
      if (isApiError(error) && error.code === 'VIEW_ONCE_ALREADY_OPENED') {
        openedHere.add(messageId);
        setPhase('opened');
      } else {
        notify.error(getErrorMessage(error, "Couldn't open this message."));
      }
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'opened') return <OpenedPlaceholder />;

  if (phase === 'viewing') {
    return (
      <div>
        <div className={away ? 'pointer-events-none blur-2xl' : undefined}>{children}</div>
        <button
          type="button"
          onClick={() => {
            setPhase('opened');
          }}
          className="mt-2 text-xs font-semibold underline"
        >
          Close, it can't be opened again
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      className="flex items-center gap-2 rounded-xl bg-black/10 px-3 py-2 text-sm font-semibold"
      aria-label={`Tap to view ${noun}`}
    >
      <Eye className="size-4" aria-hidden="true" />
      Tap to view
    </button>
  );
};

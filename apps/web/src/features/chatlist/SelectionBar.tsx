// The bar shown in select mode: a count, "Select all" and one button per bulk action.
import { useEffect } from 'react';
import {
  Archive,
  ArchiveRestore,
  BellOff,
  Bell,
  CheckCheck,
  Pin,
  PinOff,
  Trash2,
  X,
} from 'lucide-react';
import type { ConversationSummary } from '@chat/contracts';
import { isFlickChat } from '@/features/ai/isFlickBot';
import { isMuted, mutedUntilFor } from '../organise/prefs';
import {
  archiveChats,
  isUnread,
  muteChats,
  pinChats,
  toggleRead,
  unarchiveChats,
} from './rowActions';
import { useSelection } from './useSelection';

const barButton = 'btn btn-ghost btn-sm min-h-[44px] min-w-[44px] px-2';

export const SelectionBar = ({
  chats,
  visibleIds,
  archivedView,
  onDelete,
}: {
  /** The ticked chats. */
  chats: ConversationSummary[];
  /** Every chat the list shows right now (for "Select all"). */
  visibleIds: string[];
  archivedView: boolean;
  onDelete: (chats: ConversationSummary[]) => void;
}) => {
  const end = useSelection((s) => s.end);

  // Escape leaves select mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') end();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [end]);

  const none = chats.length === 0;
  const pinnable = chats.filter((c) => !isFlickChat(c));
  const allPinned = pinnable.length > 0 && pinnable.every((c) => c.prefs.pinned);
  const allMuted = chats.length > 0 && chats.every((c) => isMuted(c.prefs));
  const anyUnread = chats.some(isUnread);
  const allTicked = visibleIds.length > 0 && chats.length === visibleIds.length;

  // After a bulk action the selection has done its job.
  const then = (job: Promise<unknown>): void => {
    void job.then(() => {
      end();
    });
  };

  return (
    <div
      role="toolbar"
      aria-label="Selected chats"
      className="flex flex-wrap items-center gap-1 border-b border-base-content/10 bg-primary/10 px-2 py-1"
    >
      <button type="button" className={barButton} aria-label="Cancel selection" onClick={end}>
        <X className="size-5" aria-hidden="true" />
      </button>
      <span className="mr-auto text-sm font-semibold" aria-live="polite">
        {chats.length} selected
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        onClick={() => {
          useSelection.getState().selectAll(allTicked ? [] : visibleIds);
        }}
      >
        {allTicked ? 'Select none' : 'Select all'}
      </button>
      <button
        type="button"
        className={barButton}
        disabled={none}
        aria-label={anyUnread ? 'Mark as read' : 'Mark as unread'}
        title={anyUnread ? 'Mark as read' : 'Mark as unread'}
        onClick={() => {
          then(toggleRead(chats));
        }}
      >
        <CheckCheck className="size-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={barButton}
        disabled={pinnable.length === 0}
        aria-label={allPinned ? 'Unpin' : 'Pin'}
        title={allPinned ? 'Unpin' : 'Pin'}
        onClick={() => {
          then(pinChats(pinnable, !allPinned));
        }}
      >
        {allPinned ? (
          <PinOff className="size-5" aria-hidden="true" />
        ) : (
          <Pin className="size-5" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className={barButton}
        disabled={none}
        aria-label={allMuted ? 'Unmute' : 'Mute'}
        title={allMuted ? 'Unmute' : 'Mute always'}
        onClick={() => {
          then(muteChats(chats, allMuted ? null : mutedUntilFor(null)));
        }}
      >
        {allMuted ? (
          <Bell className="size-5" aria-hidden="true" />
        ) : (
          <BellOff className="size-5" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className={barButton}
        disabled={chats.filter((c) => !isFlickChat(c)).length === 0}
        aria-label={archivedView ? 'Unarchive' : 'Archive'}
        title={archivedView ? 'Unarchive' : 'Archive'}
        onClick={() => {
          const target = chats.filter((c) => !isFlickChat(c));
          then(archivedView ? unarchiveChats(target) : archiveChats(target));
        }}
      >
        {archivedView ? (
          <ArchiveRestore className="size-5" aria-hidden="true" />
        ) : (
          <Archive className="size-5" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className={`${barButton} text-error`}
        disabled={none}
        aria-label="Delete"
        title="Delete"
        onClick={() => {
          onDelete(chats);
        }}
      >
        <Trash2 className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
};

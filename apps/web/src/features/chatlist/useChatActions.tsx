// One place that knows how to run a list action for a chat and owns the dialogs some of them
// need (how long to mute, "Delete this chat?"). The Sidebar renders `dialogs` once.
import { useCallback, useState, type ReactNode } from 'react';
import type { ConversationSummary } from '@chat/contracts';
import { MuteModal } from '../organise/ChatOptionsMenu';
import { isMuted } from '../organise/prefs';
import { DeleteChatDialog } from './DeleteChatDialog';
import {
  archiveChats,
  muteChats,
  pinChats,
  toggleRead,
  unarchiveChats,
  type ActionId,
} from './rowActions';
import { useSelection } from './useSelection';

export const useChatActions = (): {
  run: (id: ActionId, c: ConversationSummary) => void;
  askDelete: (chats: ConversationSummary[]) => void;
  dialogs: ReactNode;
} => {
  const [muteFor, setMuteFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ConversationSummary[] | null>(null);

  const run = useCallback((id: ActionId, c: ConversationSummary): void => {
    switch (id) {
      case 'read':
        void toggleRead([c]);
        break;
      case 'pin':
        void pinChats([c], !c.prefs.pinned);
        break;
      case 'mute':
        if (isMuted(c.prefs)) void muteChats([c], null);
        else setMuteFor(c.id);
        break;
      case 'archive':
        void (c.prefs.archived ? unarchiveChats([c]) : archiveChats([c]));
        break;
      case 'delete':
        setDeleting([c]);
        break;
    }
  }, []);

  const dialogs = (
    <>
      {muteFor && (
        <MuteModal
          conversationId={muteFor}
          open
          onClose={() => {
            setMuteFor(null);
          }}
        />
      )}
      <DeleteChatDialog
        chats={deleting}
        onClose={() => {
          setDeleting(null);
        }}
        onDone={() => {
          useSelection.getState().end();
        }}
      />
    </>
  );

  return { run, askDelete: setDeleting, dialogs };
};

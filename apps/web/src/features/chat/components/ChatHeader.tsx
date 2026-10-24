import { useState, type ReactNode } from 'react';
import { ArrowLeft, Info, Phone, Sparkles, Timer, Users, Video, X } from 'lucide-react';
import type { ConversationSummary } from '@chat/contracts';
import { Avatar, type PopoverMenuItem } from '@/components/ui';
import { FlickPanel } from '@/features/ai/FlickPanel';
import { ChatOptionsMenu } from '../../organise/ChatOptionsMenu';
import { SearchPanel } from '../../search/SearchPanel';
import { useCallStore } from '@/features/calls/useCallStore';
import { useGroupCallStore } from '@/features/groupcall/useGroupCallStore';
import { conversationAvatar, conversationTitle, presenceLabel } from '../conversationView';
import { useChatStore } from '../useChatStore';
import { DisappearingDialog, DisappearingMenu } from '@/features/content/DisappearingMenu';
import { timerLabel } from '@/features/content/disappearing';
import { GroupInfoModal } from './GroupInfoModal';

export const ChatHeader = ({ conversation }: { conversation: ConversationSummary }) => {
  const select = useChatStore((s) => s.select);
  const peer = conversation.peer;
  const presence = useChatStore((s) => (peer ? s.presence[peer.id] : undefined));
  const activity = useChatStore((s) => s.typing[conversation.id]);
  const initiateCall = useCallStore((s) => s.initiateCall);
  const callsDisabled = useCallStore((s) => s.callStatus !== 'idle');
  const groupCallActive = useGroupCallStore((s) => s.status !== 'idle');
  const [infoOpen, setInfoOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [flickOpen, setFlickOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);

  const title = conversationTitle(conversation);
  const isGroup = conversation.type === 'group';
  const busy = Object.values(activity ?? {})[0];
  const subtitle = busy
    ? busy === 'typing'
      ? 'typing…'
      : busy.startsWith('recording')
        ? 'recording…'
        : 'sending a file…'
    : isGroup
      ? `${conversation.member_count} members`
      : presenceLabel(presence);

  const close = (): void => {
    select(null);
  };

  // Phones keep only back, name, voice call and "⋮": the other actions live in that menu
  // (the inline buttons below are `max-sm:hidden`, the menu items `sm:hidden`).
  const icon = (Icon: typeof Video): ReactNode => <Icon className="size-5" aria-hidden="true" />;
  const phoneItems: PopoverMenuItem[] = [
    {
      label: `Disappearing messages: ${timerLabel(conversation.settings.disappearing_timer_s)}`,
      icon: icon(Timer),
      onClick: () => {
        setTimerOpen(true);
      },
    },
    ...(peer
      ? [
          {
            label: 'Video call',
            icon: icon(Video),
            disabled: callsDisabled,
            onClick: () => void initiateCall(conversation.id, peer, 'video'),
          },
        ]
      : []),
    {
      label: 'Ask Flick',
      icon: icon(Sparkles),
      onClick: () => {
        setFlickOpen(true);
      },
    },
    ...(isGroup
      ? [
          {
            label: 'Start group call',
            icon: icon(Users),
            disabled: callsDisabled || groupCallActive,
            onClick: () =>
              void useGroupCallStore.getState().join({ conversation_id: conversation.id }),
          },
          {
            label: 'Group info',
            icon: icon(Info),
            onClick: () => {
              setInfoOpen(true);
            },
          },
        ]
      : []),
  ];

  return (
    <header className="glass flex items-center justify-between gap-3 border-b border-base-content/10 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={close}
          className="btn btn-circle btn-ghost btn-sm min-h-11 min-w-11 sm:hidden"
          aria-label="Back to chats"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </button>

        <Avatar
          src={conversationAvatar(conversation)}
          name=""
          size="sm"
          online={Boolean(presence?.online)}
          imgClassName="ring-2 ring-primary/20 shadow-sm"
        />

        <div className="min-w-0">
          <h2 className="truncate font-display text-base font-bold tracking-tight">{title}</h2>
          <p
            className={`truncate text-sm ${busy ? 'font-medium text-primary' : 'text-base-content/60'}`}
          >
            {subtitle}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <DisappearingMenu conversation={conversation} className="max-sm:hidden" />
        {peer && (
          <>
            <button
              type="button"
              onClick={() => void initiateCall(conversation.id, peer, 'audio')}
              disabled={callsDisabled}
              className="btn btn-circle btn-ghost btn-sm min-h-11 min-w-11 text-base-content/70 hover:text-primary disabled:opacity-40 sm:min-h-8 sm:min-w-8"
              aria-label={`Start voice call with ${title}`}
              title="Voice call"
            >
              <Phone className="size-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void initiateCall(conversation.id, peer, 'video')}
              disabled={callsDisabled}
              className="btn btn-circle btn-ghost btn-sm text-base-content/70 hover:text-primary disabled:opacity-40 max-sm:hidden"
              aria-label={`Start video call with ${title}`}
              title="Video call"
            >
              <Video className="size-5" aria-hidden="true" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => {
            setFlickOpen(true);
          }}
          className="btn btn-circle btn-ghost btn-sm text-base-content/70 hover:text-primary max-sm:hidden"
          aria-label="Ask Flick"
          title="Ask Flick"
        >
          <Sparkles className="size-5" aria-hidden="true" />
        </button>
        {isGroup && (
          <button
            type="button"
            onClick={() =>
              void useGroupCallStore.getState().join({ conversation_id: conversation.id })
            }
            disabled={callsDisabled || groupCallActive}
            className="btn btn-circle btn-ghost btn-sm text-base-content/70 hover:text-primary disabled:opacity-40 max-sm:hidden"
            aria-label="Start group call"
            title="Start group call"
          >
            <Users className="size-5" aria-hidden="true" />
          </button>
        )}
        {isGroup && (
          <button
            type="button"
            onClick={() => {
              setInfoOpen(true);
            }}
            className="btn btn-circle btn-ghost btn-sm text-base-content/70 hover:text-primary max-sm:hidden"
            aria-label="Group info"
            title="Group info"
          >
            <Info className="size-5" aria-hidden="true" />
          </button>
        )}
        <ChatOptionsMenu
          conversation={conversation}
          phoneItems={phoneItems}
          onSearch={() => {
            setSearchOpen(true);
          }}
        />
        <button
          type="button"
          onClick={close}
          className="btn btn-circle btn-ghost btn-sm hidden sm:inline-flex"
          aria-label="Close conversation"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <DisappearingDialog
        conversation={conversation}
        open={timerOpen}
        onClose={() => {
          setTimerOpen(false);
        }}
      />

      <SearchPanel
        open={searchOpen}
        conversationId={conversation.id}
        onClose={() => {
          setSearchOpen(false);
        }}
      />

      <FlickPanel
        conversation={conversation}
        open={flickOpen}
        onClose={() => {
          setFlickOpen(false);
        }}
      />

      {isGroup && (
        <GroupInfoModal
          conversation={conversation}
          open={infoOpen}
          onClose={() => {
            setInfoOpen(false);
          }}
        />
      )}
    </header>
  );
};

export default ChatHeader;

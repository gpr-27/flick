import { CheckCheck, ListChecks, MoreVertical } from 'lucide-react';
import { PopoverMenu } from '@/components/ui';
import { notify } from '@/components/ui/notify';
import { markAllRead } from './markAllRead';

/** The "⋮" menu in the chat list header. */
export const ChatListMenu = ({ onSelectChats }: { onSelectChats?: () => void }) => (
  <PopoverMenu
    label="Chat list menu"
    icon={<MoreVertical className="size-5" aria-hidden="true" />}
    items={[
      ...(onSelectChats
        ? [
            {
              label: 'Select chats',
              icon: <ListChecks className="size-4" aria-hidden="true" />,
              onClick: onSelectChats,
            },
          ]
        : []),
      {
        label: 'Mark all as read',
        icon: <CheckCheck className="size-4" aria-hidden="true" />,
        onClick: () => {
          if (markAllRead() === 0) notify.info('Nothing to mark as read.');
        },
      },
    ]}
  />
);

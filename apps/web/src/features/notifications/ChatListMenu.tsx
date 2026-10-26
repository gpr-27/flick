import { CheckCheck, ListChecks, MoreVertical } from 'lucide-react';
import { PopoverMenu, type PopoverMenuItem } from '@/components/ui';
import { notify } from '@/components/ui/notify';
import { markAllRead } from './markAllRead';

/** The "⋮" menu in the chat list header. */
export const ChatListMenu = ({
  onSelectChats,
  phoneItems = [],
  triggerClassName,
}: {
  onSelectChats?: () => void;
  /** Header actions that sit inline on laptops but fold into this menu on phones (`sm:hidden`). */
  phoneItems?: readonly PopoverMenuItem[];
  triggerClassName?: string;
}) => (
  <PopoverMenu
    label="Chat list menu"
    icon={<MoreVertical className="size-5" aria-hidden="true" />}
    triggerClassName={triggerClassName}
    items={[
      ...phoneItems.map((item) => ({ ...item, className: 'sm:hidden' })),
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

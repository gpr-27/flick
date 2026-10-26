import { NavLink } from 'react-router-dom';
import { MessageSquare, Phone, Settings, Users, type LucideIcon } from 'lucide-react';
import { Badge, cn } from '@/components/ui';
import { useChatStore } from '@/features/chat/useChatStore';
import { useMissedCalls } from '@/features/calllog/useMissedCalls';
import { totalUnread } from '@/features/notifications/unreadTotal';
import { formatCount } from '@/components/ui/format';

interface Tab {
  to: string;
  label: string;
  Icon: LucideIcon;
  count: number;
  end?: boolean;
}

/** Phones: the four destinations along the bottom, 44px+ targets, above the home indicator. */
export const MobileTabBar = () => {
  const unread = useChatStore((s) => totalUnread(Object.values(s.conversations)));
  const missed = useMissedCalls((s) => s.count);
  const tabs: Tab[] = [
    { to: '/', label: 'Chats', Icon: MessageSquare, count: unread, end: true },
    { to: '/calls', label: 'Calls', Icon: Phone, count: missed },
    { to: '/people', label: 'People', Icon: Users, count: 0 },
    { to: '/settings', label: 'Settings', Icon: Settings, count: 0 },
  ];
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-base-content/10 bg-base-100/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {tabs.map(({ to, label, Icon, count, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                  isActive ? 'text-primary-text' : 'text-[var(--text-2)]',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <Icon className="size-6" strokeWidth={isActive ? 2.5 : 2} aria-hidden="true" />
                    {count > 0 && (
                      <Badge
                        variant="count"
                        label={`${count} unread`}
                        className="absolute -right-3 -top-1.5"
                      >
                        {formatCount(count)}
                      </Badge>
                    )}
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
};

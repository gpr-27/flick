import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useNotificationStore } from './useNotificationStore';

/** The navbar bell with a dot (and the number, for screen readers) while alerts are unread. */
export const BellLink = ({ className = '' }: { className?: string }) => {
  const unread = useNotificationStore((s) => s.unread);
  return (
    <Link
      to="/notifications"
      className={`btn btn-ghost btn-sm relative gap-2 rounded-full font-medium max-sm:min-h-[44px] max-sm:min-w-[44px] ${className}`}
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
    >
      <Bell className="size-4" aria-hidden="true" />
      {unread > 0 && (
        <span
          data-testid="bell-dot"
          className="absolute right-1 top-1 size-2.5 rounded-full bg-primary ring-2 ring-base-100"
        />
      )}
    </Link>
  );
};

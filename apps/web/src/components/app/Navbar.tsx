import { Link, useLocation } from 'react-router-dom';
import { UserButton } from '@clerk/clerk-react';
import {
  Bell,
  MessageSquare,
  MoreVertical,
  Moon,
  Phone,
  Settings,
  Sun,
  User,
  Users,
} from 'lucide-react';
import { Avatar, PopoverMenu, cn, type PopoverMenuItem } from '@/components/ui';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { BellLink } from '@/features/notifications/center/BellLink';
import { useNotificationStore } from '@/features/notifications/center/useNotificationStore';
import { ThemeToggle } from '@/features/settings/ThemeToggle';
import { InstallButton } from '@/pwa/InstallButton';
import { startInstall, useInstallMode } from '@/pwa/install';
import { useChatStore } from '@/features/chat/useChatStore';
import { useThemeStore } from '@/features/settings/useThemeStore';

/** Phones: theme, install, settings and profile fold into one menu (see PopoverMenu). */
const PhoneMenu = () => {
  const isDark = useThemeStore((s) => s.theme === 'dark');
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const canInstall = useInstallMode() !== 'none';
  const unread = useNotificationStore((st) => st.unread);
  const items: PopoverMenuItem[] = [
    {
      label: isDark ? 'Switch to light mode' : 'Switch to dark mode',
      icon: isDark ? (
        <Sun className="size-5" aria-hidden="true" />
      ) : (
        <Moon className="size-5" aria-hidden="true" />
      ),
      onClick: toggleTheme,
    },
    ...(canInstall ? [{ label: 'Install app', onClick: () => void startInstall() }] : []),
    {
      label: unread > 0 ? `Notifications (${unread})` : 'Notifications',
      to: '/notifications',
      icon: <Bell className="size-5" aria-hidden="true" />,
    },
    { label: 'People', to: '/people', icon: <Users className="size-5" aria-hidden="true" /> },
    {
      label: 'Settings',
      to: '/settings',
      icon: <Settings className="size-5" aria-hidden="true" />,
    },
    { label: 'Profile', to: '/profile', icon: <User className="size-5" aria-hidden="true" /> },
  ];
  return (
    <PopoverMenu
      label="More"
      icon={<MoreVertical className="size-5" aria-hidden="true" />}
      items={items}
      className="sm:hidden"
    />
  );
};

// Rendered only when signed in.
export const Navbar = () => {
  // On a phone, an open chat has its own header (back button, name, call buttons). Showing this
  // bar above it as well looked like a duplicate, so it steps aside until the chat is closed.
  const chatOpen = useChatStore((s) => s.selectedId !== null);
  const onHome = useLocation().pathname === '/';
  const hideOnPhone = chatOpen && onHome;
  const me = useSessionStore((s) => s.user);
  return (
    // The top padding keeps the bar below the iPhone notch / status bar.
    <header
      className={cn(
        'glass fixed top-0 z-40 w-full border-b border-base-content/10 pt-[env(safe-area-inset-top)]',
        hideOnPhone && 'max-sm:hidden',
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="group flex items-center gap-3 rounded-xl" aria-label="Flick home">
          <div
            className="relative grid size-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-secondary text-primary-content shadow-lg shadow-primary/25 transition-transform group-hover:-rotate-6"
            aria-hidden="true"
          >
            <MessageSquare className="size-5" strokeWidth={2.5} />
          </div>
          <div className="leading-none">
            <span className="block font-display text-xl font-bold tracking-tight">Flick</span>
            <span className="hidden text-[11px] font-medium text-base-content/60 sm:block">
              realtime messaging
            </span>
          </div>
        </Link>

        <nav className="flex items-center gap-1.5" aria-label="Account">
          {/* Desktop/tablet: every control inline. Phones: only Calls + a menu + the avatar. */}
          <InstallButton className="max-sm:hidden" />
          <ThemeToggle className="max-sm:hidden" />
          <BellLink />
          <Link
            to="/calls"
            className="btn btn-ghost btn-sm gap-2 rounded-full font-medium max-sm:min-h-[44px] max-sm:min-w-[44px]"
          >
            <Phone className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Calls</span>
            <span className="sr-only sm:hidden">Calls</span>
          </Link>
          <Link
            to="/people"
            className="btn btn-ghost btn-sm gap-2 rounded-full font-medium max-sm:hidden"
          >
            <Users className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">People</span>
          </Link>
          <Link
            to="/settings"
            className="btn btn-ghost btn-sm gap-2 rounded-full font-medium max-sm:hidden"
          >
            <Settings className="size-4" aria-hidden="true" />
            <span className="sr-only">Settings</span>
          </Link>
          <Link
            to="/profile"
            className="btn btn-ghost btn-sm gap-2 rounded-full font-medium max-sm:hidden"
          >
            <Avatar
              src={me?.avatar_url}
              name=""
              size="xs"
              className="!size-6"
              imgClassName="size-6 rounded-full object-cover"
            />
            <span className="hidden sm:inline">Profile</span>
            <span className="sr-only sm:hidden">Profile</span>
          </Link>
          <PhoneMenu />
          <UserButton />
        </nav>
      </div>
    </header>
  );
};

export default Navbar;

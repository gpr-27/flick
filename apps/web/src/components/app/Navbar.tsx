import { Link, NavLink, useLocation } from 'react-router-dom';
import { UserButton } from '@clerk/clerk-react';
import { CircleHelp, MessageSquare, MoreVertical, Moon, Settings, Sun, User } from 'lucide-react';
import { startWelcome } from '@/features/guide/welcomeRules';
import { PopoverMenu, cn, type PopoverMenuItem } from '@/components/ui';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { BellLink } from '@/features/notifications/center/BellLink';
import { ThemeToggle } from '@/features/settings/ThemeToggle';
import { InstallButton } from '@/pwa/InstallButton';
import { startInstall, useInstallMode } from '@/pwa/install';
import { useChatStore } from '@/features/chat/useChatStore';
import { useLoadMissedCalls } from '@/features/calllog/useMissedCalls';
import { useThemeStore } from '@/features/settings/useThemeStore';

/** Phones: theme, install, settings and profile fold into one menu (see PopoverMenu). */
const PhoneMenu = () => {
  const isDark = useThemeStore((s) => s.theme === 'dark');
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const canInstall = useInstallMode() !== 'none';
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
      label: 'Settings',
      to: '/settings',
      icon: <Settings className="size-5" aria-hidden="true" />,
    },
    { label: 'Profile', to: '/profile', icon: <User className="size-5" aria-hidden="true" /> },
    {
      label: 'Take the tour',
      icon: <CircleHelp className="size-5" aria-hidden="true" />,
      onClick: startWelcome,
    },
  ];
  return (
    <PopoverMenu
      label="More"
      icon={<MoreVertical className="size-5" aria-hidden="true" />}
      items={items}
      className="sm:hidden"
      guideId="nav.settings"
    />
  );
};

// Rendered only when signed in.
const linkClass = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'relative inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
    isActive
      ? 'bg-active text-primary-text'
      : 'text-[var(--text-2)] hover:bg-hover hover:text-base-content',
  );

export const Navbar = () => {
  // On a phone, an open chat has its own header (back button, name, call buttons). Showing this
  // bar above it as well looked like a duplicate, so it steps aside until the chat is closed.
  const chatOpen = useChatStore((s) => s.selectedId !== null);
  const onHome = useLocation().pathname === '/';
  const hideOnPhone = chatOpen && onHome;
  const me = useSessionStore((s) => s.user);
  const missedCalls = useLoadMissedCalls(me !== null);
  return (
    // The top padding keeps the bar below the iPhone notch / status bar.
    <header
      className={cn(
        'fixed top-0 z-40 w-full border-b border-base-content/10 bg-base-100/90 pt-[env(safe-area-inset-top)] backdrop-blur',
        hideOnPhone && 'max-sm:hidden',
      )}
    >
      <div className="mx-auto flex h-12 max-w-[1400px] items-center gap-2 px-4 sm:h-14 sm:px-5">
        <Link to="/" className="group flex items-center gap-2.5 rounded-xl" aria-label="Flick home">
          <div
            className="grid size-8 place-items-center rounded-[10px] bg-gradient-to-br from-primary to-secondary text-primary-content"
            aria-hidden="true"
          >
            <MessageSquare className="size-[18px]" strokeWidth={2.5} />
          </div>
          <span className="text-[17px] font-bold tracking-tight">Flick</span>
        </Link>

        <nav className="ml-6 hidden items-center gap-1 sm:flex" aria-label="Main">
          <NavLink to="/" end className={linkClass}>
            Chats
          </NavLink>
          <NavLink to="/calls" data-guide="nav.calls" className={linkClass}>
            Calls
            {missedCalls > 0 && (
              <span
                className="grid h-5 min-w-5 place-items-center rounded-full bg-error px-1.5 text-[11px] font-bold tabular-nums text-error-content"
                aria-label={`${missedCalls} missed`}
              >
                {missedCalls}
              </span>
            )}
          </NavLink>
          <NavLink to="/people" className={linkClass}>
            People
          </NavLink>
        </nav>

        <nav className="ml-auto flex items-center gap-1" aria-label="Account">
          <InstallButton className="max-sm:hidden" />
          <ThemeToggle className="max-sm:hidden" />
          <BellLink />
          <Link
            to="/settings"
            data-guide="nav.settings"
            aria-label="Settings"
            className="tap-target grid size-10 place-items-center rounded-full text-[var(--text-2)] hover:bg-hover hover:text-base-content max-sm:hidden"
          >
            <Settings className="size-5" aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={startWelcome}
            className="sr-only"
            aria-label="Take the tour"
          >
            Take the tour
          </button>
          <PhoneMenu />
          <UserButton />
        </nav>
      </div>
    </header>
  );
};

export default Navbar;

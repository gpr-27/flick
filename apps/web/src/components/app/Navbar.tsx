import { Link } from 'react-router-dom';
import { UserButton } from '@clerk/clerk-react';
import { MessageSquare, MoreVertical, Moon, Phone, Settings, Sun, User, Users } from 'lucide-react';
import { PopoverMenu, type PopoverMenuItem } from '@/components/ui';
import { ThemeToggle } from '@/features/settings/ThemeToggle';
import { InstallButton } from '@/pwa/InstallButton';
import { promptInstall, useInstallStore } from '@/pwa/install';
import { useThemeStore } from '@/features/settings/useThemeStore';

/** Phones: theme, install, settings and profile fold into one menu (see PopoverMenu). */
const PhoneMenu = () => {
  const isDark = useThemeStore((s) => s.theme === 'dark');
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const canInstall = useInstallStore((s) => s.event !== null);
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
    ...(canInstall ? [{ label: 'Install app', onClick: () => void promptInstall() }] : []),
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
  return (
    // The top padding keeps the bar below the iPhone notch / status bar.
    <header className="glass fixed top-0 z-40 w-full border-b border-base-content/10 pt-[env(safe-area-inset-top)]">
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
          <Link
            to="/calls"
            className="btn btn-ghost btn-sm gap-2 rounded-full font-medium max-sm:min-h-11 max-sm:min-w-11"
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
            <User className="size-4" aria-hidden="true" />
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

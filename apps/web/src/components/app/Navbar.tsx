import { Link } from 'react-router-dom';
import { UserButton } from '@clerk/clerk-react';
import { MessageSquare, Phone, Settings, User } from 'lucide-react';
import { ThemeToggle } from '@/features/settings/ThemeToggle';
import { InstallButton } from '@/pwa/InstallButton';

// Rendered only when signed in.
export const Navbar = () => {
  return (
    <header className="glass fixed top-0 z-40 w-full border-b border-base-content/10">
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
          <InstallButton />
          <ThemeToggle />
          <Link to="/calls" className="btn btn-ghost btn-sm gap-2 rounded-full font-medium">
            <Phone className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Calls</span>
            <span className="sr-only sm:hidden">Calls</span>
          </Link>
          <Link to="/settings" className="btn btn-ghost btn-sm gap-2 rounded-full font-medium">
            <Settings className="size-4" aria-hidden="true" />
            <span className="sr-only">Settings</span>
          </Link>
          <Link to="/profile" className="btn btn-ghost btn-sm gap-2 rounded-full font-medium">
            <User className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Profile</span>
            <span className="sr-only sm:hidden">Profile</span>
          </Link>
          <UserButton />
        </nav>
      </div>
    </header>
  );
};

export default Navbar;

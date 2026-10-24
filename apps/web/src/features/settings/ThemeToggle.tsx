import { Moon, Sun } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { useThemeStore } from './useThemeStore';

interface ThemeToggleProps {
  /** "floating" gives a frosted pill for pages without a navbar. */
  variant?: 'ghost' | 'floating';
  className?: string;
}

// Animated sun/moon toggle. The floating variant must be `fixed` (the caller
// offsets it); the navbar variant is `relative`. Both give the absolutely
// positioned icons a positioning context.
export const ThemeToggle = ({ variant = 'ghost', className = '' }: ThemeToggleProps) => {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      aria-pressed={isDark}
      title={label}
      className={cn(
        variant === 'floating'
          ? 'fixed glass shadow-soft hover:scale-105'
          : 'relative hover:bg-base-content/10',
        'grid size-10 place-items-center overflow-hidden rounded-full text-base-content/70 transition-all duration-200 active:scale-90',
        className,
      )}
    >
      <Sun
        aria-hidden="true"
        className={cn(
          'absolute size-5 text-amber-500 transition-all duration-300',
          isDark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100',
        )}
        strokeWidth={2.25}
      />
      <Moon
        aria-hidden="true"
        className={cn(
          'absolute size-5 text-primary transition-all duration-300',
          isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0',
        )}
        strokeWidth={2.25}
      />
    </button>
  );
};

export default ThemeToggle;

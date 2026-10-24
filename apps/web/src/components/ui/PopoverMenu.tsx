import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from './cn';
import { useFocusTrap } from './useFocusTrap';

export interface PopoverMenuItem {
  label: string;
  icon?: ReactNode;
  /** Runs after the menu closes. */
  onClick?: () => void;
  /** Renders a router link instead of a button. */
  to?: string;
  disabled?: boolean;
}

interface PopoverMenuProps {
  /** Accessible name of the trigger and of the menu. */
  label: string;
  /** Icon inside the trigger button. */
  icon: ReactNode;
  items: readonly PopoverMenuItem[];
  /** Open above the trigger (for bars at the bottom of the screen). */
  up?: boolean;
  /** Align the menu with the trigger's left edge instead of its right edge. */
  alignLeft?: boolean;
  /** Classes for the wrapper, e.g. `sm:hidden` to make it phone-only. */
  className?: string;
}

const itemClass =
  'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-base-200 focus-visible:bg-base-200 focus-visible:outline-none disabled:opacity-40';

/**
 * A small "⋮"/"+" menu: a 44px trigger and a popover of actions. Used on phones to
 * fold secondary controls away. Escape or a tap outside closes it; arrows move focus.
 */
export const PopoverMenu = ({
  label,
  icon,
  items,
  up = false,
  alignLeft = false,
  className,
}: PopoverMenuProps) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = (): void => {
    setOpen(false);
  };
  useFocusTrap(menuRef, open, { onEscape: close });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const els = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = els.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    els[(next + els.length) % els.length]?.focus();
  };

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        className="btn btn-circle btn-ghost btn-sm min-h-11 min-w-11 text-base-content/70"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" aria-hidden="true" onClick={close} />
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            className={cn(
              'glass-card absolute z-40 w-56 rounded-xl border border-base-content/10 p-1 shadow-xl',
              up ? 'bottom-full mb-2' : 'top-full mt-1',
              alignLeft ? 'left-0' : 'right-0',
            )}
          >
            {items.map((item) =>
              item.to ? (
                <Link
                  key={item.label}
                  to={item.to}
                  role="menuitem"
                  onClick={close}
                  className={itemClass}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ) : (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    close();
                    item.onClick?.();
                  }}
                  className={itemClass}
                >
                  {item.icon}
                  {item.label}
                </button>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
};

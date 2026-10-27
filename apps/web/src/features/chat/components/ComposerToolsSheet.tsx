import { useRef, useState, type KeyboardEvent } from 'react';
import { Plus } from 'lucide-react';
import { cn, useFocusTrap, type PopoverMenuItem } from '@/components/ui';
import { useBackClose } from '@/lib/useBackClose';
import { useOutsidePress } from './useOutsidePress';

/**
 * The phone composer's "+" button. It opens a panel of labelled tiles ABOVE the composer (the
 * panel is positioned against the composer, which is `relative`, not against the button).
 * A tap outside or Escape closes it; arrow keys move between tiles.
 */
export const ComposerToolsSheet = ({
  items,
  guideId,
  className,
}: {
  items: readonly PopoverMenuItem[];
  guideId?: string;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = (): void => {
    setOpen(false);
  };
  useFocusTrap(sheetRef, open, { onEscape: close });
  useOutsidePress([sheetRef, triggerRef], open, close);
  useBackClose(open, close);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 4,
      ArrowLeft: -1,
      ArrowUp: -4,
    };
    const delta = step[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    const tiles = [...(sheetRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = tiles.indexOf(document.activeElement as HTMLElement);
    tiles[Math.min(tiles.length - 1, Math.max(0, at + delta))]?.focus();
  };

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        className={cn(
          'btn btn-circle btn-ghost min-h-[44px] min-w-[44px] text-base-content/70 transition-transform',
          open && 'rotate-45 text-primary',
        )}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        data-guide={guideId}
      >
        <Plus className="size-6" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={sheetRef}
          role="menu"
          aria-label="More actions"
          onKeyDown={onKeyDown}
          className="glass-card !bg-base-100 absolute inset-x-3 bottom-full z-40 mb-2 grid grid-cols-4 gap-1 rounded-2xl border border-base-content/10 p-2 shadow-xl"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                close();
                item.onClick?.();
              }}
              className="flex min-h-[72px] flex-col items-center justify-start gap-1.5 rounded-xl px-1 py-2 text-center text-[11px] font-medium leading-tight hover:bg-base-200 focus-visible:bg-base-200 focus-visible:outline-none disabled:opacity-40"
            >
              <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

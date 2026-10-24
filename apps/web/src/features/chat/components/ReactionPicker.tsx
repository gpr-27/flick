import { useRef, type KeyboardEvent } from 'react';
import { cn, useFocusTrap } from '@/components/ui';
import { REACTIONS } from '../reactions';

interface ReactionPickerProps {
  align: 'left' | 'right';
  onPick: (emoji: string) => void;
  onClose: () => void;
}

/** Popover of quick reactions. Arrow keys move, Enter picks, Escape closes. */
export const ReactionPicker = ({ align, onPick, onClose }: ReactionPickerProps) => {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, { onEscape: onClose });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const buttons = [...(ref.current?.querySelectorAll('button') ?? [])];
    const index = buttons.findIndex((b) => b === document.activeElement);
    const next =
      buttons[(index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
    e.preventDefault();
  };

  return (
    <>
      <div className="fixed inset-0 z-10" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        role="toolbar"
        aria-label="Pick a reaction"
        onKeyDown={onKeyDown}
        className={cn(
          'glass-card absolute bottom-full z-20 mb-1 flex gap-0.5 rounded-full border border-base-content/10 p-1 shadow-xl',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        {REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              onPick(emoji);
              onClose();
            }}
            className="grid size-8 place-items-center rounded-full text-lg transition-transform hover:scale-125 hover:bg-base-200 focus-visible:bg-base-200"
            aria-label={`React ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </>
  );
};

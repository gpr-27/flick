import { useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useSwipeDismiss } from '@/lib/gestures/useSwipeDismiss';
import { useBackClose } from '@/lib/useBackClose';
import { cn } from './cn';
import { useFocusTrap } from './useFocusTrap';

export interface ModalProps {
  open: boolean;
  /** Escape and backdrop clicks call this. Omit for modals that need an explicit choice. */
  onClose?: () => void;
  /** Accessible name: id of a visible heading, or a plain label. */
  labelledBy?: string;
  label?: string;
  describedBy?: string;
  /** "alertdialog" for interruptions that need a response (e.g. an incoming call). */
  role?: 'dialog' | 'alertdialog';
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnBackdrop?: boolean;
  /** Phones: a swipe down closes the dialog. Turn off where the content has its own sheet drag. */
  swipeToDismiss?: boolean;
  overlayClassName?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Accessible modal: focus trap, Escape, focus restore, labelled dialog role. On phones the Back
 * button and a swipe down close it too (only when `onClose` is given).
 */
export const Modal = ({
  open,
  onClose,
  labelledBy,
  label,
  describedBy,
  role = 'dialog',
  initialFocusRef,
  closeOnBackdrop = true,
  swipeToDismiss = true,
  overlayClassName,
  className,
  children,
}: ModalProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open, { initialFocusRef, onEscape: onClose });
  // The phone Back button / back swipe closes the dialog, and so does a swipe down.
  useBackClose(open && Boolean(onClose), () => {
    onClose?.();
  });
  useSwipeDismiss(panelRef, open && swipeToDismiss, onClose);

  if (!open) return null;

  const onBackdrop = (e: MouseEvent<HTMLDivElement>): void => {
    if (closeOnBackdrop && onClose && e.target === e.currentTarget) onClose();
  };

  // Rendered in <body>: a parent with backdrop-filter (the glass header) would otherwise become
  // the containing block of `fixed` and trap the dialog inside itself.
  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[60] flex items-center justify-center pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] bg-black/50 backdrop-blur-[2px] animate-fade',
        overlayClassName,
      )}
      onClick={onBackdrop}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={cn(
          'max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain outline-none max-sm:animate-sheet-up sm:animate-scale-in',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};

import { useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
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
  overlayClassName?: string;
  className?: string;
  children: ReactNode;
}

/** Accessible modal: focus trap, Escape, focus restore, labelled dialog role. */
export const Modal = ({
  open,
  onClose,
  labelledBy,
  label,
  describedBy,
  role = 'dialog',
  initialFocusRef,
  closeOnBackdrop = true,
  overlayClassName,
  className,
  children,
}: ModalProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open, { initialFocusRef, onEscape: onClose });

  if (!open) return null;

  const onBackdrop = (e: MouseEvent<HTMLDivElement>): void => {
    if (closeOnBackdrop && onClose && e.target === e.currentTarget) onClose();
  };

  // Rendered in <body>: a parent with backdrop-filter (the glass header) would otherwise become
  // the containing block of `fixed` and trap the dialog inside itself.
  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[60] flex items-center justify-center pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] bg-base-content/40 backdrop-blur-sm animate-fade-in-up',
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
        className={cn('outline-none', className)}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};

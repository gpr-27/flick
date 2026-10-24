import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  "input:not([disabled]):not([type='hidden'])",
  'select:not([disabled])',
  'textarea:not([disabled])',
  "[tabindex]:not([tabindex='-1'])",
].join(',');

const getFocusable = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('inert') && !el.hidden,
  );

export interface FocusTrapOptions {
  /** Element to focus on open; defaults to the first focusable element (or the container). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
  /** Return focus to the previously focused element on close. Default true. */
  restoreFocus?: boolean;
}

/**
 * Keeps keyboard focus inside `containerRef` while `active`: moves focus in on
 * open, cycles Tab / Shift+Tab, handles Escape, and restores focus on close.
 */
export const useFocusTrap = (
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  { initialFocusRef, onEscape, restoreFocus = true }: FocusTrapOptions = {},
): void => {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const target = initialFocusRef?.current ?? getFocusable(container)[0] ?? container;
    target.focus();

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && onEscapeRef.current) {
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = getFocusable(container);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        container.focus();
        return;
      }
      const current = document.activeElement;
      if (e.shiftKey && (current === first || !container.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !container.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      if (restoreFocus && previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [active, containerRef, initialFocusRef, restoreFocus]);
};

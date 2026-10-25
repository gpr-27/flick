// Things that must keep the guide quiet: a call, an open dialog or menu, the person typing.
import { useCallStore } from '@/features/calls/useCallStore';
import { useGroupCallStore } from '@/features/groupcall/useGroupCallStore';

/** Ringing, calling or connected (a 1:1 call), or in a group call. */
export function callInProgress(): boolean {
  const group = useGroupCallStore.getState().status;
  return (
    useCallStore.getState().callStatus !== 'idle' ||
    group === 'joining' ||
    group === 'connected' ||
    group === 'reconnecting'
  );
}

const OPEN_LAYERS = '[aria-modal="true"], [role="dialog"], [role="alertdialog"], [role="menu"]';

/** Is a dialog, sheet or menu of the app open (the guide's own card does not count)? */
export function layerOpen(): boolean {
  for (const el of document.querySelectorAll<HTMLElement>(OPEN_LAYERS)) {
    if (el.closest('[data-guide-ui]')) continue;
    if (isShown(el)) return true;
  }
  return false;
}

/** Not `display: none` / `visibility: hidden` (itself or a parent). */
function isShown(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === 'function') return el.checkVisibility();
  const style = getComputedStyle(el);
  return !el.hidden && style.display !== 'none' && style.visibility !== 'hidden';
}

const TYPING_QUIET_MS = 5000;
let lastKeyAt = 0;

/** Start remembering when a key was last pressed. Returns the stop function. */
export function watchTyping(): () => void {
  const onKey = (): void => {
    lastKeyAt = Date.now();
  };
  document.addEventListener('keydown', onKey, true);
  return () => {
    document.removeEventListener('keydown', onKey, true);
  };
}

const isTextField = (el: Element | null): boolean =>
  !!el &&
  (el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement &&
      !['button', 'checkbox', 'radio', 'submit', 'file', 'range', 'color'].includes(el.type)) ||
    (el instanceof HTMLElement && el.isContentEditable));

/** A text box is focused and a key was pressed in the last few seconds. */
export function typingNow(now: number = Date.now()): boolean {
  return isTextField(document.activeElement) && now - lastKeyAt < TYPING_QUIET_MS;
}

/** Tests only. */
export function setLastKeyAtForTests(at: number): void {
  lastKeyAt = at;
}

// Small helpers for the message box: character counter, "/flick", pasted and dropped files.
import { LIMITS } from '@chat/contracts';

/** Show the counter once the text is this close to the limit (a UI choice, not a server rule). */
const COUNTER_FROM = 0.9;

export interface CounterState {
  /** Characters still free; negative means too long. */
  left: number;
  over: boolean;
}

/** Null while the text is nowhere near the limit, so the counter stays out of the way. */
export const counterState = (length: number, max = LIMITS.MAX_TEXT_LENGTH): CounterState | null =>
  length >= max * COUNTER_FROM ? { left: max - length, over: length > max } : null;

/**
 * What gets sent: exactly what was typed (newlines, indentation, tabs), minus blank lines at the
 * start and any blank space at the end.
 */
export const cleanOutgoing = (text: string): string =>
  text.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '');

/** Typing "/flick" turns into "@flick " so the bot is addressed. Null if nothing to change. */
export const expandSlashCommand = (text: string): { text: string; caret: number } | null => {
  if (text !== '/flick' && text !== '/flick ') return null;
  return { text: '@flick ', caret: '@flick '.length };
};

/** The first image on the clipboard (a screenshot, a copied picture), or null. */
export const imageFromClipboard = (data: DataTransfer | null): File | null =>
  [...(data?.files ?? [])].find((f) => f.type.startsWith('image/')) ?? null;

/** True while a drag carries files (not text or a link), so only files light up the drop area. */
export const dragHasFiles = (data: DataTransfer | null): boolean =>
  [...(data?.types ?? [])].includes('Files');

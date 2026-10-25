// Finding the real element a step points at. An element opts in with `data-guide="<id>"`. The same
// id may sit on several elements (for example a button that is a toolbar icon on a laptop and a
// menu entry on a phone); the first one that is actually on screen is used. One element can carry
// several ids separated by spaces (the phone's "+" menu stands in for many composer buttons).

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const selectorFor = (id: string): string => `[data-guide~="${CSS.escape(id)}"]`;

const hasSize = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/**
 * An element with this guide id that takes up room (not `display: none`). One that is inside the
 * window is preferred (a long chat has many messages, only some are in view); otherwise the first.
 */
export function findGuideTarget(id: string): HTMLElement | null {
  let fallback: HTMLElement | null = null;
  for (const el of document.querySelectorAll<HTMLElement>(selectorFor(id))) {
    if (!hasSize(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth) {
      return el;
    }
    fallback ??= el;
  }
  return fallback;
}

/** Is any part of the box inside the window? */
export function isOnScreen(box: Box, viewport: { width: number; height: number }): boolean {
  return (
    box.left + box.width > 0 &&
    box.top + box.height > 0 &&
    box.left < viewport.width &&
    box.top < viewport.height
  );
}

export const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

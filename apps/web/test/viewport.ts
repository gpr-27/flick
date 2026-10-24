/**
 * Responsive helpers. The app's phone/laptop split is pure CSS (Tailwind `sm:` is min-width
 * 640px, `max-sm:` the opposite), and jsdom does not load CSS, so a test cannot ask "is this
 * visible". It reads the class conventions instead: an element is hidden on a viewport when it
 * or an ancestor carries the class that hides it there.
 */
export type Viewport = 'phone' | 'laptop';

/** True when the element, or any ancestor, is hidden by its Tailwind classes on this viewport. */
export function isHiddenOn(el: Element, viewport: Viewport): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const tokens = new Set((node.getAttribute('class') ?? '').split(/\s+/));
    const hasShowAtSm = [...tokens].some((t) =>
      /^sm:(block|flex|inline|inline-flex|grid|inline-block)$/.test(t),
    );
    if (viewport === 'phone') {
      if (tokens.has('max-sm:hidden')) return true;
      // `hidden sm:flex`: hidden below the breakpoint.
      if (tokens.has('hidden') && hasShowAtSm) return true;
      if (tokens.has('hidden') && ![...tokens].some((t) => t.startsWith('sm:'))) return true;
    } else {
      if (tokens.has('sm:hidden')) return true;
      if (tokens.has('hidden') && !hasShowAtSm) return true;
    }
  }
  return false;
}

export const isVisibleOn = (el: Element, viewport: Viewport): boolean => !isHiddenOn(el, viewport);

/** Sets matchMedia for code that branches in JS (for example the theme's colour scheme). */
export function mockMatchMedia(matches: (query: string) => boolean): void {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
}

/** matchMedia as a phone (390px wide, touch) or a laptop (1280px wide, mouse) would answer it. */
export function mockViewport(viewport: Viewport): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: viewport === 'phone' ? 390 : 1280,
  });
  const phone = viewport === 'phone';
  mockMatchMedia((query) => {
    const q = query.replace(/\s+/g, '').toLowerCase();
    if (q.includes('min-width:640px')) return !phone;
    if (q.includes('max-width:639')) return phone;
    if (q.includes('pointer:coarse') || q.includes('hover:none')) return phone;
    if (q.includes('pointer:fine') || q.includes('hover:hover')) return !phone;
    return false;
  });
}

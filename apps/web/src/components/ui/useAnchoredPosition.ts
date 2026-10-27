import { useLayoutEffect, useState, type RefObject } from 'react';
import { computePlacement, type Placement } from './placement';

/**
 * Measures the anchor and the panel and keeps the panel inside the viewport (see computePlacement).
 * Returns null until the first measurement, so the panel can stay hidden instead of jumping.
 */
export const useAnchoredPosition = (
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  options: { prefer?: 'down' | 'up'; align?: 'left' | 'right'; active?: boolean } = {},
): Placement | null => {
  const { prefer = 'down', align = 'right', active = true } = options;
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    if (!active) return;
    const place = (): void => {
      const a = anchor.current?.getBoundingClientRect();
      const el = panel.current;
      if (!a || !el) return;
      const vv = window.visualViewport;
      const next = computePlacement({
        anchor: a,
        // scrollHeight is the content height even while max-height is cutting the panel short.
        panel: { width: el.offsetWidth, height: el.scrollHeight },
        viewport: {
          width: document.documentElement.clientWidth || window.innerWidth,
          height: vv?.height ?? window.innerHeight,
        },
        prefer,
        align,
      });
      setPlacement((old) =>
        old &&
        old.top === next.top &&
        old.left === next.left &&
        old.maxHeight === next.maxHeight &&
        old.maxWidth === next.maxWidth
          ? old
          : next,
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    if (panel.current) ro?.observe(panel.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      ro?.disconnect();
    };
  }, [anchor, panel, prefer, align, active]);

  return placement;
};

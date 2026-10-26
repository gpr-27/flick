import { useEffect, useRef, type RefObject } from 'react';

/**
 * Calls `onOutside` when a pointer goes down outside every element in `refs` while `active`.
 * (A full-screen backdrop does not work inside the composer: its glass effect makes a `fixed`
 * child cover only the composer.)
 */
export const useOutsidePress = (
  refs: readonly RefObject<HTMLElement | null>[],
  active: boolean,
  onOutside: () => void,
): void => {
  const handler = useRef(onOutside);
  const list = useRef(refs);
  useEffect(() => {
    handler.current = onOutside;
    list.current = refs;
  });
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (target && list.current.some((r) => r.current?.contains(target))) return;
      handler.current();
    };
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('pointerdown', onDown);
    };
  }, [active]);
};

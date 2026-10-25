import { useEffect, useState } from 'react';

const WIDE = '(min-width: 1024px)';

/** True on laptop-sized screens. */
export const useIsWide = (): boolean => {
  const query = (): MediaQueryList | null =>
    typeof window.matchMedia === 'function' ? window.matchMedia(WIDE) : null;
  const [wide, setWide] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const update = (): void => {
      setWide(mq.matches);
    };
    mq.addEventListener('change', update);
    return () => {
      mq.removeEventListener('change', update);
    };
  }, []);
  return wide;
};

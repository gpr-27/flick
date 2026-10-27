import { useEffect, useState } from 'react';

const PHONE = '(max-width: 639px)';

/** True on phone-sized screens (Tailwind's `max-sm`). */
export const useIsPhone = (): boolean => {
  const query = (): MediaQueryList | null =>
    typeof window.matchMedia === 'function' ? window.matchMedia(PHONE) : null;
  const [phone, setPhone] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const update = (): void => {
      setPhone(mq.matches);
    };
    mq.addEventListener('change', update);
    return () => {
      mq.removeEventListener('change', update);
    };
  }, []);
  return phone;
};

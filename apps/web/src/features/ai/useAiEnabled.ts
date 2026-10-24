import { useEffect, useState } from 'react';
import { getAiEnabled } from './aiApi';

let cached: Promise<boolean> | null = null;

/**
 * Whether the server has an AI provider key. null while loading. Asked once per page load;
 * a failed request is not cached, so the next screen tries again.
 */
export const useAiEnabled = (): boolean | null => {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    cached ??= getAiEnabled().catch(() => {
      cached = null;
      return false;
    });
    void cached.then((value) => {
      if (live) setEnabled(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return enabled;
};

/** For tests. */
export const resetAiEnabledCache = (): void => {
  cached = null;
};

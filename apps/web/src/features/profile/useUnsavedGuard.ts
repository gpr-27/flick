import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Warns before unsaved changes are lost: closing or reloading the tab shows the browser's own
 * prompt, and clicking a link inside the app asks first (`pending` is the place it wanted to go;
 * show a dialog, then call `leave()` or `stay()`). The browser's Back button is not covered:
 * this app uses the simple router, which cannot block it.
 */
export function useUnsavedGuard(dirty: boolean): {
  pending: string | null;
  leave: () => void;
  stay: () => void;
} {
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault(); // the browser then shows its own "leave site?" prompt
    };
    const onClick = (e: MouseEvent): void => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const link = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target === '_blank') return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const where = url.pathname + url.search + url.hash;
      if (where === window.location.pathname + window.location.search + window.location.hash)
        return;
      // Capture phase: stop the router from following the link before we have asked.
      e.preventDefault();
      e.stopPropagation();
      setPending(where);
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  return {
    pending,
    leave: () => {
      const where = pending;
      setPending(null);
      if (where) navigate(where);
    },
    stay: () => {
      setPending(null);
    },
  };
}

import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * A panel that opens under (or above, when there is no room) an anchor button, drawn in <body>.
 * It must not be a child of the button's header: a header with `backdrop-filter` (the glass look)
 * clips anything inside it, which hid the chat menu behind the header's edge and made it look empty.
 */
export const AnchoredPanel = ({
  anchor,
  children,
  className,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  onClose: () => void;
}) => {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    const place = (): void => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  if (!pos) return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[55]" aria-hidden="true" onClick={onClose} />
      <div
        className={className}
        style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 56 }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
};

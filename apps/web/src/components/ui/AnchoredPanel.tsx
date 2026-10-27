import { useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useBackClose } from '@/lib/useBackClose';
import { useAnchoredPosition } from './useAnchoredPosition';

/**
 * A panel that opens next to an anchor button, drawn in <body>. It must not be a child of the
 * button's header: a header with `backdrop-filter` (the glass look) or `overflow` clips anything
 * inside it. It flips above the anchor near the bottom of the screen, shifts to stay inside the
 * viewport and scrolls inside when it is taller than the room available.
 */
export const AnchoredPanel = ({
  anchor,
  children,
  className,
  onClose,
  prefer = 'down',
  align = 'right',
}: {
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  onClose: () => void;
  prefer?: 'down' | 'up';
  align?: 'left' | 'right';
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(anchor, ref, { prefer, align });
  // Mounted only while open: the phone Back button closes it.
  useBackClose(true, onClose);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[65]" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        className={className}
        style={{
          position: 'fixed',
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          maxHeight: pos?.maxHeight,
          maxWidth: pos?.maxWidth,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          zIndex: 66,
          visibility: pos ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
};

import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefCallback,
} from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/components/ui';

// Three sizes, small to large. A shared screen is wide, so it gets the wide shape.
const SIZES = ['w-24 sm:w-32 md:w-40', 'w-36 sm:w-48 md:w-64', 'w-56 sm:w-72 md:w-96'] as const;
const KEY_STEP_PX = 16;

const clamp = (value: number, max: number): number =>
  Math.max(0, Math.min(value, Math.max(0, max)));

/**
 * Your own picture in the call. Drag it anywhere, resize it with the corner button, or move it
 * with the arrow keys. It used to be a fixed box, which hid what you were sharing and sat on top of
 * what you wanted to see.
 */
export const SelfView = ({
  videoRef,
  placeholder,
  sharing,
}: {
  videoRef: RefCallback<HTMLVideoElement>;
  /** Shown instead of the video (camera off). Null when the video should play. */
  placeholder: ReactNode | null;
  sharing: boolean;
}) => {
  const [size, setSize] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);

  const bounds = (): { width: number; height: number } => {
    const parent = box.current?.offsetParent;
    const r = parent?.getBoundingClientRect();
    return { width: r?.width ?? 0, height: r?.height ?? 0 };
  };
  const moveTo = (x: number, y: number): void => {
    const el = box.current;
    if (!el) return;
    const b = bounds();
    setPos({ x: clamp(x, b.width - el.offsetWidth), y: clamp(y, b.height - el.offsetHeight) });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    const el = box.current;
    if (!el || e.target !== e.currentTarget) return;
    const parent = el.offsetParent?.getBoundingClientRect();
    grab.current = {
      dx: e.clientX - el.getBoundingClientRect().left,
      dy: e.clientY - el.getBoundingClientRect().top,
    };
    // Remember where the box is now, so the first drag starts from here and does not jump.
    if (!pos && parent) {
      const r = el.getBoundingClientRect();
      setPos({ x: r.left - parent.left, y: r.top - parent.top });
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const g = grab.current;
    const parent = box.current?.offsetParent?.getBoundingClientRect();
    if (!g || !parent) return;
    moveTo(e.clientX - parent.left - g.dx, e.clientY - parent.top - g.dy);
  };
  const release = (): void => {
    grab.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP_PX, 0],
      ArrowRight: [KEY_STEP_PX, 0],
      ArrowUp: [0, -KEY_STEP_PX],
      ArrowDown: [0, KEY_STEP_PX],
    };
    const delta = steps[e.key];
    if (!delta || !box.current) return;
    e.preventDefault();
    const current = pos ?? { x: box.current.offsetLeft, y: box.current.offsetTop };
    moveTo(current.x + delta[0], current.y + delta[1]);
  };

  const Resize = size === SIZES.length - 1 ? Minimize2 : Maximize2;

  return (
    <div
      ref={box}
      role="group"
      tabIndex={0}
      aria-label="Your picture. Drag to move, or use the arrow keys."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={onKeyDown}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={cn(
        'absolute z-10 cursor-grab touch-none overflow-hidden rounded-2xl shadow-xl ring-2 ring-white/20 active:cursor-grabbing',
        sharing ? 'aspect-video' : 'aspect-[3/4]',
        SIZES[size],
        // Until it is dragged: top-right on phones (clears the controls), bottom-right on larger screens.
        pos ? '' : 'right-3 top-16 sm:bottom-28 sm:right-4 sm:top-auto',
      )}
    >
      {placeholder ?? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label="Your camera"
          className={cn(
            'pointer-events-none h-full w-full',
            sharing ? 'object-contain bg-black' : 'scale-x-[-1] object-cover',
          )}
        />
      )}
      {placeholder && <div className="pointer-events-none absolute inset-0">{placeholder}</div>}
      <button
        type="button"
        onClick={() => {
          setSize((s) => (s + 1) % SIZES.length);
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        className="absolute left-1 top-1 grid size-8 place-items-center rounded-full bg-black/50 text-white"
        aria-label={
          size === SIZES.length - 1 ? 'Make your picture smaller' : 'Make your picture bigger'
        }
      >
        <Resize className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
};

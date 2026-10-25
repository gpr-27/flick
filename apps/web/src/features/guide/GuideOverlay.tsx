// The coach mark: a dimmed screen with a spotlight around the real element a step points at, and a
// card that explains it. If the element is missing, hidden or off screen the card is centred and
// nothing is cut out, so the person never sees a broken overlay.
//
// Accessible by design: the card is a labelled dialog, focus moves into it and comes back when it
// closes, Tab stays inside, Esc closes, the arrow keys move between steps, each step is announced,
// and nothing moves for people who asked for less motion.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/components/ui';
import { useFocusTrap } from '@/components/ui/useFocusTrap';
import { getTopic } from './catalog';
import { SPOT_PADDING, placeCard, type Placement } from './placement';
import { boxOf, findGuideTarget, isOnScreen, type Box } from './targets';
import { useGuideStore } from './useGuideStore';

const PHONE_QUERY = '(max-width: 639px)';

const sameBox = (a: Box | null, b: Box | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5);

/** Where the highlighted element is on screen, kept up to date; null when there is none to show. */
function useTargetBox(targetId: string | undefined, stepKey: string): Box | null {
  const [measured, setBox] = useState<Box | null>(null);

  useEffect(() => {
    if (!targetId) return;
    let frame = 0;
    let scrolled = false;
    const measure = (): void => {
      frame = 0;
      const el = findGuideTarget(targetId);
      if (!el) {
        setBox(null);
        return;
      }
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      let next = boxOf(el);
      const comfortable = next.top >= 0 && next.top + next.height <= viewport.height;
      if (!comfortable && !scrolled) {
        // Bring it into view once; after that the person's own scrolling is left alone.
        scrolled = true;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        next = boxOf(el);
      }
      const shown = isOnScreen(next, viewport) ? next : null;
      setBox((prev) => (sameBox(prev, shown) ? prev : shown));
    };
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();

    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    // The element may appear later (a chat is still opening) or move; the card's own changes are ignored.
    const mutations = new MutationObserver((records) => {
      const outside = records.some(
        (r) => !(r.target instanceof Element && r.target.closest('[data-guide-ui]')),
      );
      if (outside) schedule();
    });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true });
    // A slow animation or a late image can move things without any event.
    const poll = window.setInterval(schedule, 500);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      mutations.disconnect();
      window.clearInterval(poll);
    };
  }, [targetId, stepKey]);

  return targetId ? measured : null;
}

/** The size of the notch / home-bar areas, read from the CSS `env()` values. */
function readSafeArea(): { top: number; bottom: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const area = {
    top: Number.parseFloat(style.paddingTop) || 0,
    bottom: Number.parseFloat(style.paddingBottom) || 0,
  };
  probe.remove();
  return area;
}

export const GuideOverlay = () => {
  const active = useGuideStore((s) => s.active);
  const { next, back, close, setEnabled } = useGuideStore.getState();
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const topic = active ? getTopic(active.topicId) : undefined;
  const step = topic && active ? topic.steps[active.step] : undefined;

  const box = useTargetBox(step?.target, active ? `${active.topicId}:${active.step}` : '');
  const [card, setCard] = useState({ width: 352, height: 200 });
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);

  // Track the window and the card's own size so the placement stays right.
  useEffect(() => {
    const update = (): void => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setPhone(window.matchMedia(PHONE_QUERY).matches);
    };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measure = (): void => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        setCard((prev) =>
          Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1
            ? prev
            : { width: r.width, height: r.height },
        );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [active?.topicId, active?.step]);

  // The notch / home-bar sizes, read once when the card first appears.
  const [safe] = useState(readSafeArea);

  useFocusTrap(cardRef, true, { initialFocusRef: primaryRef });

  // A step change can remove the button that had focus (Back on the first step): keep focus in the card.
  useEffect(() => {
    primaryRef.current?.focus();
  }, [active?.step, active?.topicId]);

  // Keys work even if a click outside the card moved focus away from it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const current = useGuideStore.getState().active;
        const t = current && getTopic(current.topicId);
        if (!current || !t || t.steps.length < 2) return;
        // Typing in a box inside the card is not expected, but never steal the arrows from one.
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        if (e.key === 'ArrowRight' && current.step < t.steps.length - 1) next();
        if (e.key === 'ArrowLeft') back();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [next, back, close]);

  if (!active || !topic || !step) return null;

  const total = topic.steps.length;
  const isLast = active.step === total - 1;
  const isTour = active.source === 'welcome';
  const placement: Placement = placeCard({
    viewport,
    target: box,
    card,
    placement: step.placement,
    phone,
    safe,
  });

  const cardStyle =
    placement.mode === 'anchored'
      ? { top: placement.top, left: placement.left }
      : placement.mode === 'docked'
        ? placement.edge === 'bottom'
          ? { bottom: 'calc(env(safe-area-inset-bottom) + 12px)' }
          : { top: 'calc(env(safe-area-inset-top) + 12px)' }
        : {
            top: Math.max(12, (viewport.height - card.height) / 2),
            left: Math.max(12, (viewport.width - card.width) / 2),
          };

  return (
    <div data-guide-ui className="fixed inset-0 z-[55]">
      {box && placement.mode !== 'centered' ? (
        <div
          aria-hidden="true"
          data-testid="guide-spotlight"
          className="pointer-events-none absolute rounded-2xl ring-2 ring-primary motion-safe:transition-all motion-safe:duration-200"
          style={{
            top: box.top - SPOT_PADDING,
            left: box.left - SPOT_PADDING,
            width: box.width + SPOT_PADDING * 2,
            height: box.height + SPOT_PADDING * 2,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)',
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-black/60" />
      )}
      {/* Catches clicks so the app underneath is not pressed by accident. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={() => {
          if (!isTour) close();
        }}
      />

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        data-testid="guide-card"
        className={cn(
          'absolute rounded-3xl border border-base-content/10 bg-base-100 p-5 text-base text-base-content shadow-2xl outline-none',
          placement.mode === 'docked' ? 'inset-x-3' : 'w-[22rem] max-w-[calc(100vw-1.5rem)]',
        )}
        style={cardStyle}
      >
        {total > 1 && (
          <div className="mb-2 flex items-center gap-2" aria-hidden="true">
            <ol className="flex gap-1">
              {topic.steps.map((_, i) => (
                <li
                  key={i}
                  className={cn(
                    'h-1.5 w-4 rounded-full',
                    i === active.step ? 'bg-primary' : 'bg-base-content/20',
                  )}
                />
              ))}
            </ol>
            <span className="text-sm font-medium text-base-content/70">
              {active.step + 1} of {total}
            </span>
          </div>
        )}
        <h2 id={titleId} className="font-display text-lg font-bold">
          {step.title}
        </h2>
        <p id={bodyId} className="mt-1 text-base text-base-content/80">
          {step.body}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          {isTour ? (
            <button type="button" className="btn btn-ghost min-h-[44px] text-base" onClick={close}>
              Skip
            </button>
          ) : active.source === 'tip' ? (
            <button
              type="button"
              className="btn btn-ghost min-h-[44px] text-base"
              onClick={() => {
                setEnabled(false);
              }}
            >
              Don&apos;t show tips
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {active.step > 0 && (
              <button type="button" className="btn btn-ghost min-h-[44px] text-base" onClick={back}>
                Back
              </button>
            )}
            <button
              ref={primaryRef}
              type="button"
              className="btn btn-primary min-h-[44px] text-base"
              onClick={next}
            >
              {isLast ? (isTour ? 'Done' : 'Got it') : 'Next'}
            </button>
          </div>
        </div>
      </div>

      {/* Read out by screen readers whenever the step changes. */}
      <div role="status" aria-live="polite" className="sr-only">
        {total > 1 ? `Step ${active.step + 1} of ${total}: ${step.title}` : step.title}
      </div>
    </div>
  );
};

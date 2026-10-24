import { FlickAvatar } from './FlickBadge';

/** "Flick is thinking…" with animated dots; announced politely to screen readers. */
export const FlickThinking = () => (
  <div className="flex items-end gap-2 pb-1" role="status" aria-live="polite">
    <FlickAvatar size="xs" />
    <div className="bubble-recv flex items-center gap-2 rounded-2xl rounded-bl-md px-4 py-3">
      <span className="flex items-center gap-1" aria-hidden="true">
        {['0ms', '150ms', '300ms'].map((delay) => (
          <span
            key={delay}
            className="size-2 animate-bounce rounded-full bg-primary/60"
            style={{ animationDelay: delay, animationDuration: '1s' }}
          />
        ))}
      </span>
      <span className="text-xs text-base-content/60">Flick is thinking…</span>
    </div>
  </div>
);

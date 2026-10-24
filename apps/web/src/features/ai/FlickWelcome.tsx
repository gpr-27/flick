import { FlickAvatar } from './FlickBadge';
import { EXAMPLE_PROMPTS } from './examplePrompts';

/** The empty Flick chat: a greeting and tappable example prompts that send as messages. */
export const FlickWelcome = ({ onPick }: { onPick: (prompt: string) => void }) => (
  <div className="flex h-full flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
    <FlickAvatar size="lg" />
    <div className="space-y-1.5">
      <p className="font-display text-xl font-bold tracking-tight">Ask Flick anything</p>
      <p className="max-w-xs text-sm leading-relaxed text-base-content/60">
        Your built-in AI assistant. Try one of these to get started.
      </p>
    </div>
    <ul className="flex max-w-md flex-wrap justify-center gap-2">
      {EXAMPLE_PROMPTS.map((prompt) => (
        <li key={prompt}>
          <button
            type="button"
            onClick={() => {
              onPick(prompt);
            }}
            className="chip min-h-11 px-4 text-sm font-medium hover:bg-primary/10"
          >
            {prompt}
          </button>
        </li>
      ))}
    </ul>
  </div>
);

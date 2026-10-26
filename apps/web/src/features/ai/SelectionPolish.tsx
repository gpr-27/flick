import { useState } from 'react';
import { ChevronDown, Wand2 } from 'lucide-react';
import { AI_COMPOSE_TONES, LIMITS } from '@chat/contracts';
import { Spinner, cn } from '@/components/ui';
import { composeText } from './aiApi';
import { useAiEnabled } from './useAiEnabled';
import { useAiTask } from './useAiTask';

type Tone = (typeof AI_COMPOSE_TONES)[number];

const TONE_LABEL: Record<Tone, string> = {
  casual: 'Casual',
  formal: 'Formal',
  shorter: 'Shorter',
  longer: 'Longer',
  friendly: 'Friendly',
};

/**
 * A small floating "Polish" button (with a Rewrite menu) for the text selected in the message
 * box. Only the selection is replaced. The buttons keep the box focused so the selection stays.
 */
export const SelectionPolish = ({
  selected,
  onReplace,
  className,
}: {
  selected: string;
  /** Called with Flick's version of the selected text only. */
  onReplace: (replacement: string) => void;
  className?: string;
}) => {
  const enabled = useAiEnabled();
  const task = useAiTask();
  const [menu, setMenu] = useState(false);
  const loading = task.state.status === 'loading';
  const tooLong = selected.length > LIMITS.MAX_TEXT_LENGTH;

  if (enabled !== true) return null;

  const run = (request: Parameters<typeof composeText>[0]): void => {
    setMenu(false);
    void task
      .run(async ({ signal }) => (await composeText(request, signal)).text)
      .then((result) => {
        if (result) onReplace(result);
      });
  };
  const keepSelection = (e: { preventDefault: () => void }): void => {
    e.preventDefault();
  };
  const button =
    'inline-flex min-h-[36px] items-center gap-1 rounded-full px-3 text-xs font-semibold text-primary-text hover:bg-hover disabled:opacity-50';

  return (
    <div
      role="toolbar"
      aria-label="Improve the selected text"
      onMouseDown={keepSelection}
      onPointerDown={keepSelection}
      className={cn(
        'glass-card z-20 flex flex-col rounded-2xl p-1 shadow-[var(--shadow-2)]',
        className,
      )}
    >
      <div className="flex items-center">
        <button
          type="button"
          className={button}
          disabled={loading || tooLong}
          onClick={() => {
            run({ mode: 'polish', text: selected });
          }}
        >
          {loading ? (
            <Spinner size="xs" label="Flick is writing" />
          ) : (
            <Wand2 className="size-3.5" aria-hidden="true" />
          )}
          Polish
        </button>
        <button
          type="button"
          className={button}
          disabled={loading || tooLong}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => {
            setMenu((v) => !v);
          }}
        >
          Rewrite
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      {menu && (
        <div role="menu" aria-label="Rewrite as" className="flex flex-wrap gap-1 p-1">
          {AI_COMPOSE_TONES.map((tone) => (
            <button
              key={tone}
              type="button"
              role="menuitem"
              className="chip cursor-pointer"
              onClick={() => {
                run({ mode: 'rewrite', text: selected, tone });
              }}
            >
              {TONE_LABEL[tone]}
            </button>
          ))}
        </div>
      )}
      {task.state.status === 'error' && !task.state.notConfigured && (
        <p role="alert" className="px-2 py-1 text-xs text-error">
          {task.state.error}
        </p>
      )}
    </div>
  );
};

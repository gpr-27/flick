import { useEffect, useState } from 'react';
import { cn } from '@/components/ui';
import { getChatStyle, setChatStyle } from './writingApi';

type Style = 'none' | 'formal' | 'casual' | 'friendly' | 'custom';
const STYLES: readonly { value: Style; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'formal', label: 'Always formal' },
  { value: 'casual', label: 'Always casual' },
  { value: 'friendly', label: 'Always friendly' },
  { value: 'custom', label: 'Custom…' },
];

const chip = 'chip shrink-0 cursor-pointer whitespace-nowrap max-sm:min-h-[36px]';

/** "Style for this chat": applied automatically whenever Flick writes or suggests here. */
export const ChatStylePicker = ({ conversationId }: { conversationId: string }) => {
  const [style, setStyle] = useState<Style>('none');
  const [custom, setCustom] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getChatStyle(conversationId)
      .then((r) => {
        if (!live) return;
        setStyle(r.style);
        setCustom(r.custom ?? '');
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [conversationId]);

  const save = (next: Style, text: string): void => {
    setStyle(next);
    setFailed(false);
    setChatStyle(conversationId, { style: next, custom: next === 'custom' ? text : null }).catch(
      () => {
        setFailed(true);
      },
    );
  };

  return (
    <div role="group" aria-label="Style for this chat" className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-[var(--text-2)]">Style for this chat</span>
      <div className="flex flex-wrap gap-1.5">
        {STYLES.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={style === s.value}
            onClick={() => {
              save(s.value, custom);
            }}
            className={cn(chip, style === s.value && 'bg-primary !text-primary-content')}
          >
            {s.label}
          </button>
        ))}
      </div>
      {style === 'custom' && (
        <input
          type="text"
          value={custom}
          maxLength={200}
          aria-label="Custom style"
          placeholder="e.g. short and teasing"
          className="input input-bordered input-sm text-base sm:text-sm"
          onChange={(e) => {
            setCustom(e.target.value);
          }}
          onBlur={() => {
            save('custom', custom);
          }}
        />
      )}
      {failed && (
        <span role="alert" className="text-xs text-error">
          Could not save.
        </span>
      )}
    </div>
  );
};

import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { ReminderDialog } from '@/features/reminders/ReminderDialog';
import { cn } from '@/components/ui';
import { matchSlash, parseSlash, type SlashName } from './slashCommands';
import { expandSaved, loadSavedReplies, matchSaved } from './savedReplies';

interface Options {
  text: string;
  setText: (text: string) => void;
  conversationId: string;
  onPoll: () => void;
  /** Opens the schedule dialog for this text. */
  onSchedule: (text: string) => void;
  onWrite: () => void;
}

/**
 * The "/" menu above the composer and what each command does. MessageInput calls onKeyDown first
 * (arrows, Enter, Tab, Escape while the menu is open) and runTyped when Send is pressed.
 */
export const useSlashCommands = (o: Options) => {
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [reminder, setReminder] = useState<string | null>(null);
  const [writePrompt, setWritePrompt] = useState('');

  const saved = dismissed === o.text ? [] : matchSaved(o.text, loadSavedReplies());
  const items = dismissed === o.text ? [] : matchSlash(o.text);
  const total = items.length + saved.length;
  const open = total > 0;
  const current = Math.min(active, Math.max(0, total - 1));

  const run = (name: SlashName, arg: string): void => {
    if (name === 'poll') {
      o.setText('');
      o.onPoll();
    } else if (name === 'remind') {
      o.setText('');
      setReminder(arg);
    } else if (name === 'schedule') {
      o.setText(arg);
      o.onSchedule(arg);
    } else {
      o.setText('');
      setWritePrompt(arg);
      o.onWrite();
    }
  };

  const onKeyDown = (e: KeyboardEvent): boolean => {
    if (!open) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((current + (e.key === 'ArrowDown' ? 1 : total - 1)) % total);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const command = items[current];
      const reply = saved[current - items.length];
      if (!command && !reply) return false;
      e.preventDefault();
      if (command) run(command.name, '');
      else if (reply) o.setText(reply.text);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDismissed(o.text);
      return true;
    }
    return false;
  };

  /** On Send: "/remind call mom" runs the command instead of being sent. True if it did. */
  const runTyped = (text: string): boolean => {
    const expanded = expandSaved(text, loadSavedReplies());
    if (expanded) {
      o.setText(expanded);
      return true;
    }
    const parsed = parseSlash(text);
    if (!parsed) return false;
    run(parsed.name, parsed.arg);
    return true;
  };

  const node: ReactNode = (
    <>
      {open && (
        <ul
          role="listbox"
          aria-label="Commands"
          className="glass-card absolute bottom-full left-3 z-30 mb-1 w-64 rounded-xl border border-base-content/10 p-1 shadow-xl"
        >
          {items.map((c, i) => (
            <li
              key={c.name}
              role="option"
              aria-selected={i === current}
              // mousedown, not click: a click would first blur the input.
              onMouseDown={(e) => {
                e.preventDefault();
                run(c.name, '');
              }}
              className={cn(
                'cursor-pointer rounded-lg px-3 py-1.5 text-sm',
                i === current && 'bg-primary/15',
              )}
            >
              <span className="font-semibold">/{c.name}</span>{' '}
              <span className="text-base-content/60">{c.hint}</span>
            </li>
          ))}
          {saved.map((r, i) => (
            <li
              key={r.shortcut}
              role="option"
              aria-selected={items.length + i === current}
              onMouseDown={(e) => {
                e.preventDefault();
                o.setText(r.text);
              }}
              className={cn(
                'cursor-pointer rounded-lg px-3 py-1.5 text-sm',
                items.length + i === current && 'bg-primary/15',
              )}
            >
              <span className="font-semibold">/{r.shortcut}</span>{' '}
              <span className="text-base-content/60">{r.text.slice(0, 40)}</span>
            </li>
          ))}
        </ul>
      )}
      <ReminderDialog
        target={{ conversationId: o.conversationId }}
        preview="This chat"
        initialNote={reminder ?? ''}
        open={reminder !== null}
        onClose={() => {
          setReminder(null);
        }}
      />
    </>
  );

  return { open, onKeyDown, runTyped, node, writePrompt };
};

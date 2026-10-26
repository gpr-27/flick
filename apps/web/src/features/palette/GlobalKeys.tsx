import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/ui';
import { conversationTitle } from '@/features/chat/conversationView';
import { useChatStore } from '@/features/chat/useChatStore';
import { useThemeStore } from '@/features/settings/useThemeStore';
import { SHORTCUTS, actionForKey } from '@/features/settings/shortcuts';
import { fuzzyFilter } from './fuzzy';

interface Command {
  id: string;
  label: string;
  run: () => void;
}

const isTyping = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return Boolean(el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable));
};

/** Mounted once in the signed-in app: the global key handler, the Ctrl/Cmd+K palette and the '?' cheat sheet. */
export const GlobalKeys = () => {
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const action = actionForKey(e, isTyping(e.target));
      if (!action) return;
      e.preventDefault();
      if (action === 'palette') setPaletteOpen((v) => !v);
      else if (action === 'help') setHelpOpen(true);
      else if (action === 'newChat') navigate('/people');
      else if (action === 'search') {
        navigate('/');
        // The chat list may need a moment to mount.
        setTimeout(
          () => document.querySelector<HTMLInputElement>('input[type="search"]')?.focus(),
          0,
        );
      } else {
        const { conversations, selectedId, select } = useChatStore.getState();
        const list = Object.values(conversations).sort((a, b) =>
          (b.last_message?.created_at ?? '').localeCompare(a.last_message?.created_at ?? ''),
        );
        if (list.length === 0) return;
        const at = list.findIndex((c) => c.id === selectedId);
        const next = action === 'nextChat' ? at + 1 : at - 1;
        const target = list[Math.min(list.length - 1, Math.max(0, next))];
        if (target) {
          navigate('/');
          select(target.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [navigate]);

  return (
    <>
      {paletteOpen && (
        <Palette
          onClose={() => {
            setPaletteOpen(false);
          }}
        />
      )}
      {helpOpen && (
        <Modal
          open
          onClose={() => {
            setHelpOpen(false);
          }}
          labelledBy="shortcuts-title"
          className="glass-card mx-4 w-full max-w-md rounded-3xl p-6 animate-scale-in"
        >
          <h2 id="shortcuts-title" className="mb-3 font-display text-xl font-bold">
            Keyboard shortcuts
          </h2>
          <ul className="scroll-slim max-h-96 space-y-2 overflow-y-auto text-sm">
            {SHORTCUTS.map((s) => (
              <li key={s.keys} className="flex justify-between gap-3">
                <kbd className="kbd kbd-sm shrink-0">{s.keys}</kbd>
                <span className="text-right text-base-content/70">{s.does}</span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
};

const Palette = ({ onClose }: { onClose: () => void }) => {
  const navigate = useNavigate();
  const conversations = useChatStore((s) => s.conversations);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      navigate(path);
    };
    return [
      { id: 'people', label: 'People', run: go('/people') },
      { id: 'settings', label: 'Settings', run: go('/settings') },
      { id: 'calendar', label: 'Calendar', run: go('/calendar') },
      { id: 'profile', label: 'Profile', run: go('/profile') },
      { id: 'theme', label: 'Toggle theme', run: toggleTheme },
      ...Object.values(conversations).map((c) => ({
        id: `chat-${c.id}`,
        label: conversationTitle(c),
        run: () => {
          navigate('/');
          useChatStore.getState().select(c.id);
        },
      })),
    ];
  }, [conversations, navigate, toggleTheme]);

  const shown = useMemo(() => fuzzyFilter(commands, query).slice(0, 8), [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const choose = (c: Command | undefined): void => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="palette-title"
      className="glass-card mx-4 w-full max-w-md rounded-3xl p-4 animate-scale-in"
    >
      <h2 id="palette-title" className="sr-only">
        Command palette
      </h2>
      <input
        ref={inputRef}
        className="input input-bordered w-full"
        placeholder="Jump to a chat or page"
        aria-label="Search commands"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-results"
        aria-activedescendant={shown[index] ? `palette-${shown[index].id}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndex((i) => Math.min(shown.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(shown[index]);
          }
        }}
      />
      <ul role="listbox" id="palette-results" aria-label="Results" className="mt-2 space-y-1">
        {shown.length === 0 && <li className="p-2 text-sm text-base-content/60">No matches.</li>}
        {shown.map((c, i) => (
          <li key={c.id} id={`palette-${c.id}`} role="option" aria-selected={i === index}>
            <button
              type="button"
              className={`w-full rounded-xl px-3 py-2 text-left text-sm ${i === index ? 'bg-primary/15' : ''}`}
              onClick={() => {
                choose(c);
              }}
            >
              {c.label}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
};

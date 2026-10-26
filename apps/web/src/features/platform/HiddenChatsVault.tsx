// "Hidden chats": locked chats are kept out of the main list and shown here, after the app-lock PIN
// is typed again. It only works once an app-lock PIN exists (Settings > Privacy); without one the
// locked chats stay in the normal list as before. Like the locks it builds on, this is a
// convenience, not security.
import { useRef, useState, type FormEvent } from 'react';
import { EyeOff, Lock } from 'lucide-react';
import type { ConversationSummary } from '@chat/contracts';
import { Modal } from '@/components/ui';
import { pinMatches } from '@/features/settings/screenLock';
import { useSettingsStore } from '@/features/settings/useSettingsStore';

export const HiddenChatsRow = ({
  chats,
  onOpen,
  titleOf,
}: {
  chats: ConversationSummary[];
  onOpen: (id: string) => void;
  titleOf: (c: ConversationSummary) => string;
}) => {
  const hash = useSettingsStore((s) => s.screenLockHash);
  const [open, setOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  if (chats.length === 0) return null;

  const close = (): void => {
    setOpen(false);
    setUnlocked(false);
    setPin('');
    setWrong(false);
  };
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (await pinMatches(pin, hash)) setUnlocked(true);
    else {
      setWrong(true);
      setPin('');
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={`Hidden chats (${chats.length})`}
        className="flex min-h-[56px] w-full items-center gap-3 bg-base-100 px-4 py-2.5 text-left text-[15px] font-medium hover:bg-[var(--bg-hover,oklch(var(--bc)/0.05))]"
        onClick={() => {
          setOpen(true);
        }}
      >
        <EyeOff className="size-5 text-primary" aria-hidden="true" />
        <span className="flex-1" aria-hidden="true">
          Hidden chats
        </span>
        <span className="text-sm tabular-nums" aria-hidden="true">
          {chats.length}
        </span>
      </button>
      <Modal
        open={open}
        onClose={close}
        labelledBy="hidden-chats-title"
        initialFocusRef={inputRef}
        className="glass-card mx-4 w-full max-w-sm space-y-3 rounded-3xl p-6 animate-scale-in"
      >
        <h2 id="hidden-chats-title" className="font-display text-lg font-bold">
          Hidden chats
        </h2>
        {unlocked ? (
          <ul className="space-y-1">
            {chats.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="flex min-h-[44px] w-full items-center gap-2 rounded-2xl px-2 text-left hover:bg-base-200"
                  onClick={() => {
                    onOpen(c.id);
                    close();
                  }}
                >
                  <Lock className="size-4" aria-hidden="true" />
                  <span className="truncate">{titleOf(c)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            <label className="block text-sm font-semibold">
              Enter your app-lock PIN
              <input
                ref={inputRef}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                className="input-soft mt-1 min-h-[44px] w-full"
                value={pin}
                aria-invalid={wrong}
                onChange={(e) => {
                  setPin(e.target.value);
                }}
              />
            </label>
            {wrong && (
              <p role="alert" className="text-sm text-error">
                That PIN is not right.
              </p>
            )}
            <button type="submit" className="btn btn-primary min-h-[44px] w-full rounded-2xl">
              Show hidden chats
            </button>
          </form>
        )}
        <button
          type="button"
          className="btn btn-ghost min-h-[44px] w-full rounded-2xl"
          onClick={close}
        >
          Close
        </button>
      </Modal>
    </>
  );
};

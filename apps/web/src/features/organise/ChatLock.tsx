import { useRef, useState, type FormEvent } from 'react';
import { Lock, X } from 'lucide-react';
import type { ConversationSummary } from '@chat/contracts';
import { Button, Modal } from '@/components/ui';
import { notify } from '@/components/ui/notify';
import { conversationTitle } from '../chat/conversationView';
import { useChatStore } from '../chat/useChatStore';
import { hashPasscode, passcodeMatches, useLockStore } from './lock';
import { updatePrefs } from './prefs';

export const LOCK_NOTE =
  'This is a convenience lock. It hides the chat on screen until you enter the passcode in this tab. The server stores only a hash of the passcode and does not enforce the lock, so it is not encryption.';

const MIN_LENGTH = 4;
const field = 'input-soft w-full';

/** Shown instead of the chat while it is locked. */
export const LockScreen = ({ conversation }: { conversation: ConversationSummary }) => {
  const [passcode, setPasscode] = useState('');
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const unlock = useLockStore((s) => s.unlock);
  const select = useChatStore((s) => s.select);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    const ok = await passcodeMatches(conversation.id, passcode, conversation.prefs.lock_hash);
    setBusy(false);
    if (ok) unlock(conversation.id);
    else {
      setWrong(true);
      setPasscode('');
    }
  };

  return (
    <section
      className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
      aria-label={`Locked chat with ${conversationTitle(conversation)}`}
    >
      <Lock className="size-10 text-primary" aria-hidden="true" />
      <h2 className="font-display text-xl font-bold">This chat is locked</h2>
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-xs space-y-3">
        <label htmlFor="unlock-passcode" className="sr-only">
          Passcode
        </label>
        <input
          id="unlock-passcode"
          type="password"
          autoComplete="off"
          autoFocus
          value={passcode}
          onChange={(e) => {
            setPasscode(e.target.value);
            setWrong(false);
          }}
          placeholder="Passcode"
          aria-invalid={wrong}
          aria-describedby={wrong ? 'unlock-error' : undefined}
          className={field}
        />
        {wrong && (
          <p id="unlock-error" role="alert" className="text-sm text-error">
            Wrong passcode. Try again.
          </p>
        )}
        <Button variant="gradient" type="submit" disabled={busy || !passcode}>
          Unlock
        </Button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => select(null)}>
          Back to chats
        </button>
      </form>
      <p className="max-w-xs text-xs text-base-content/60">{LOCK_NOTE}</p>
    </section>
  );
};

/** Set a passcode (mode "set") or turn the lock off after checking the current one ("remove"). */
export const LockModal = ({
  conversation,
  mode,
  open,
  onClose,
}: {
  conversation: ConversationSummary;
  mode: 'set' | 'remove';
  open: boolean;
  onClose: () => void;
}) => {
  const [passcode, setPasscode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const unlock = useLockStore((s) => s.unlock);
  const relock = useLockStore((s) => s.relock);

  const close = (): void => {
    setPasscode('');
    setConfirm('');
    setError('');
    onClose();
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    if (mode === 'set') {
      if (passcode.length < MIN_LENGTH) {
        setError(`Use at least ${MIN_LENGTH} characters.`);
        return;
      }
      if (passcode !== confirm) {
        setError('The two passcodes do not match.');
        return;
      }
      setBusy(true);
      // Only the hash leaves the browser.
      const lock_hash = await hashPasscode(conversation.id, passcode);
      const ok = await updatePrefs(conversation.id, { locked: true, lock_hash });
      setBusy(false);
      if (ok) {
        unlock(conversation.id); // you just typed it; lock again with "Lock now"
        notify.success('Chat lock is on.');
        close();
      }
      return;
    }
    setBusy(true);
    const matches = await passcodeMatches(conversation.id, passcode, conversation.prefs.lock_hash);
    if (!matches) {
      setBusy(false);
      setError('Wrong passcode.');
      return;
    }
    const ok = await updatePrefs(conversation.id, { locked: false, lock_hash: null });
    setBusy(false);
    if (ok) {
      relock(conversation.id);
      close();
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      labelledBy="lock-title"
      initialFocusRef={firstRef}
      className="glass-card mx-4 w-full max-w-md rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="lock-title" className="font-display text-xl font-bold">
          {mode === 'set' ? 'Lock this chat' : 'Remove chat lock'}
        </h2>
        <button
          type="button"
          onClick={close}
          className="btn btn-circle btn-ghost btn-sm"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <label className="block text-sm font-medium">
          {mode === 'set' ? 'New passcode' : 'Current passcode'}
          <input
            ref={firstRef}
            type="password"
            autoComplete="off"
            value={passcode}
            onChange={(e) => {
              setPasscode(e.target.value);
            }}
            className={`${field} mt-1`}
          />
        </label>
        {mode === 'set' && (
          <label className="block text-sm font-medium">
            Repeat passcode
            <input
              type="password"
              autoComplete="off"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
              }}
              className={`${field} mt-1`}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <p className="text-xs text-base-content/60">{LOCK_NOTE}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
          <Button variant="gradient" type="submit" disabled={busy || !passcode}>
            {mode === 'set' ? 'Lock chat' : 'Remove lock'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

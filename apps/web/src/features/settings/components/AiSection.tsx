import { useState, type FormEvent } from 'react';
import { ENDPOINTS, UpdateSettingsRequest } from '@chat/contracts';
import { Modal } from '@/components/ui';
import { notify } from '@/components/ui/notify';
import { useChatStore } from '@/features/chat/useChatStore';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { useServerSettings } from '../useServerSettings';
import { useSetting } from '../useSettingsStore';
import { ActionButton, Card, ToggleRow } from './controls';

const LANGUAGES = ['English', 'Hindi', 'Telugu', 'Spanish', 'French', 'German', 'Arabic'];

/** After "clear chat" the open copy of the conversation is emptied without a reload. */
const emptyFlickChatHere = (): void => {
  useChatStore.setState((s) => {
    const ids = Object.values(s.conversations)
      .filter((c) => c.peer?.is_bot)
      .map((c) => c.id);
    return {
      conversations: Object.fromEntries(
        Object.entries(s.conversations).map(([id, c]) => [
          id,
          ids.includes(id) ? { ...c, last_message: null, unread_count: 0 } : c,
        ]),
      ),
      threads: Object.fromEntries(
        Object.entries(s.threads).map(([id, t]) => [
          id,
          ids.includes(id) ? { ...t, messages: [] } : t,
        ]),
      ),
    };
  });
};

export const AiSection = () => {
  const [showModel, setShowModel] = useSetting('showModelName');
  const { settings, error, change } = useServerSettings();
  // null = not edited yet: the field shows what is saved.
  const [typed, setTyped] = useState<string | null>(null);
  const language = typed ?? settings?.ai_language ?? '';
  const setLanguage = setTyped;
  const [languageError, setLanguageError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const saveLanguage = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const value = language.trim();
    const parsed = UpdateSettingsRequest.shape.ai_language.safeParse(value === '' ? null : value);
    if (!parsed.success) {
      setLanguageError('Use a language name such as Hindi or French (letters only).');
      return;
    }
    setLanguageError(null);
    if (await change({ ai_language: parsed.data ?? null })) notify.success('Saved.');
  };

  const clearChat = async (): Promise<void> => {
    try {
      await getApi().call(ENDPOINTS.users.clearFlickChat);
      emptyFlickChatHere();
      notify.success('Your chat with Flick was cleared.');
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't clear the chat."));
    } finally {
      setConfirmClear(false);
    }
  };

  return (
    <Card title="Flick assistant">
      <ToggleRow
        label="Show the model name"
        hint="A small “Answered by …” line under every AI answer."
        checked={showModel}
        onChange={setShowModel}
      />

      <form onSubmit={(e) => void saveLanguage(e)} className="py-1">
        <label className="block font-semibold" htmlFor="ai-language">
          Preferred reply language
        </label>
        <p className="text-sm text-base-content/60">
          Flick answers you in this language. Empty: the language you write in.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            id="ai-language"
            list="ai-language-options"
            className="input-soft min-h-11 min-w-0 flex-1"
            maxLength={40}
            value={language}
            disabled={!settings}
            onChange={(e) => {
              setLanguage(e.target.value);
            }}
          />
          <datalist id="ai-language-options">
            {LANGUAGES.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <button
            type="submit"
            className="btn btn-primary min-h-11 rounded-2xl"
            disabled={!settings}
          >
            Save
          </button>
        </div>
        {(languageError ?? error) && (
          <p role="alert" className="mt-1 text-sm text-error">
            {languageError ?? error}
          </p>
        )}
      </form>

      <div className="flex min-h-11 items-center justify-between gap-4 py-1">
        <span>
          <span className="block font-semibold">Clear my chat with Flick</span>
          <span className="block text-sm text-base-content/60">
            Removes the messages for you only. The AI does not remember past chats.
          </span>
        </span>
        <ActionButton
          tone="danger"
          onClick={() => {
            setConfirmClear(true);
          }}
        >
          Clear
        </ActionButton>
      </div>

      <Modal
        open={confirmClear}
        onClose={() => {
          setConfirmClear(false);
        }}
        labelledBy="clear-flick-title"
        className="glass-card mx-4 w-full max-w-sm space-y-3 rounded-3xl p-6 animate-scale-in"
      >
        <h2 id="clear-flick-title" className="font-display text-lg font-bold">
          Clear your chat with Flick?
        </h2>
        <p className="text-sm">
          This removes every message in it from your devices. It cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost min-h-11 rounded-2xl"
            onClick={() => {
              setConfirmClear(false);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-error min-h-11 rounded-2xl"
            onClick={() => void clearChat()}
          >
            Clear chat
          </button>
        </div>
      </Modal>
    </Card>
  );
};

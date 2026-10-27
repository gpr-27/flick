// Settings > Appearance > Chat wallpaper: the wallpaper for ALL chats (a chat's own pick wins).
// "Apply to every chat" also clears every chat's own wallpaper, a few requests at a time.
import { useState } from 'react';
import { Modal, notify } from '@/components/ui';
import { useChatStore } from '@/features/chat/useChatStore';
import {
  chatsWithOwnWallpaper,
  resetChatWallpapers,
  type ClearOne,
} from '@/features/organise/resetChatWallpapers';
import { WallpaperPicker } from '@/features/organise/WallpaperPicker';
import { useSetting } from '../useSettingsStore';

const plural = (n: number): string => `${String(n)} ${n === 1 ? 'chat has' : 'chats have'}`;

type Confirm = 'all' | 'none' | null;

export const ChatWallpaperSection = ({ clearOne }: { clearOne?: ClearOne } = {}) => {
  const [saved, setSaved] = useSetting('defaultWallpaper');
  const conversations = useChatStore((s) => s.conversations);
  const [draft, setDraft] = useState<string | null>(saved);
  const [pickerKey, setPickerKey] = useState(0);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failedIds, setFailedIds] = useState<string[]>([]);

  const own = chatsWithOwnWallpaper(conversations);
  const running = progress !== null;

  const run = async (ids: string[]): Promise<void> => {
    setProgress({ done: 0, total: ids.length });
    setMessage(null);
    const result = await resetChatWallpapers(ids, {
      ...(clearOne ? { clear: clearOne } : {}),
      onProgress: (done, total) => {
        setProgress({ done, total });
      },
    });
    setProgress(null);
    setFailedIds(result.failed);
    if (result.failed.length === 0) {
      setMessage(
        ids.length === 0
          ? 'Done. Every chat shows this wallpaper.'
          : `Done. Every chat shows this wallpaper (${String(ids.length)} reset).`,
      );
      notify.success('Wallpaper applied to every chat.');
    } else {
      setMessage(
        `${String(result.done)} reset, ${String(result.failed.length)} could not be reset. Try again to finish the rest.`,
      );
    }
  };

  const applyEverywhere = (id: string | null): void => {
    setSaved(id);
    setDraft(id);
    setPickerKey((k) => k + 1);
    setConfirm(null);
    void run(chatsWithOwnWallpaper(useChatStore.getState().conversations));
  };

  return (
    <section aria-labelledby="chat-wallpaper-heading" className="space-y-3 py-1">
      <div>
        <h3 id="chat-wallpaper-heading" className="font-semibold">
          Chat wallpaper
        </h3>
        <p className="text-sm text-base-content/60">
          For all chats, including Saved messages and Flick. A wallpaper you pick inside a chat
          overrides this one for that chat only.
        </p>
      </div>

      <WallpaperPicker
        key={pickerKey}
        value={saved}
        noneLabel="None"
        hideActions
        onSelect={setDraft}
        onApply={() => undefined}
        onCancel={() => undefined}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          className="btn btn-primary min-h-[44px] rounded-2xl"
          disabled={draft === saved || running}
          onClick={() => {
            setSaved(draft);
            setMessage(
              own.length > 0
                ? `Saved. ${plural(own.length)} their own wallpaper and keep it.`
                : 'Saved for all chats.',
            );
          }}
        >
          Use for chats without their own
        </button>
        <button
          type="button"
          className="btn btn-outline min-h-[44px] rounded-2xl"
          disabled={running}
          onClick={() => {
            setConfirm('all');
          }}
        >
          Apply to every chat
        </button>
        <button
          type="button"
          className="btn btn-ghost min-h-[44px] rounded-2xl"
          disabled={running}
          onClick={() => {
            setConfirm('none');
          }}
        >
          Remove wallpaper from all chats
        </button>
      </div>
      <p className="text-xs text-base-content/60">
        “Use for chats without their own” keeps the chats that have their own wallpaper. Your
        pictures are stored on this device only; this setting is also kept on this device only.
      </p>

      <div role="status" aria-live="polite" className="min-h-5 text-sm">
        {progress
          ? `Resetting chats… ${String(progress.done)} of ${String(progress.total)}`
          : message}
        {!running && failedIds.length > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-ghost ml-2 min-h-[44px]"
            onClick={() => {
              void run(failedIds);
            }}
          >
            Try again
          </button>
        )}
      </div>

      <Modal
        open={confirm !== null}
        onClose={() => {
          setConfirm(null);
        }}
        labelledBy="apply-wallpaper-title"
        className="glass-card mx-4 w-full max-w-sm space-y-3 rounded-3xl p-6 animate-scale-in"
      >
        <h2 id="apply-wallpaper-title" className="font-display text-lg font-bold">
          {confirm === 'none' ? 'Remove wallpaper from all chats?' : 'Apply to every chat?'}
        </h2>
        <p className="text-sm">
          {confirm === 'none'
            ? 'Every chat will show the normal background. '
            : 'Every chat will show this wallpaper. '}
          {own.length === 0
            ? 'No chat has its own wallpaper right now.'
            : `${plural(own.length)} their own wallpaper; ${own.length === 1 ? 'it' : 'they'} will be reset.`}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost min-h-[44px] rounded-2xl"
            onClick={() => {
              setConfirm(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary min-h-[44px] rounded-2xl"
            onClick={() => {
              applyEverywhere(confirm === 'none' ? null : draft);
            }}
          >
            {confirm === 'none' ? 'Remove from all' : 'Apply to every chat'}
          </button>
        </div>
      </Modal>
    </section>
  );
};

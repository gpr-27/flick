// The "⋮" menu in the chat header: pin, archive, favourite, mute, wallpaper, lock, search.
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MoreVertical, X } from 'lucide-react';
import type { ConversationSummary } from '@chat/contracts';
import { Modal, cn, useFocusTrap } from '@/components/ui';
import { useChatStore } from '../chat/useChatStore';
import { LockModal } from './ChatLock';
import { useLockStore } from './lock';
import { MUTE_OPTIONS, isMuted, mutedUntilFor, updatePrefs } from './prefs';
import { WALLPAPERS } from './wallpapers';

const panel = 'glass-card mx-4 w-full max-w-sm rounded-3xl p-6 animate-scale-in';

const DialogHeader = ({
  id,
  title,
  onClose,
}: {
  id: string;
  title: string;
  onClose: () => void;
}) => (
  <div className="mb-4 flex items-center justify-between">
    <h2 id={id} className="font-display text-xl font-bold">
      {title}
    </h2>
    <button
      type="button"
      onClick={onClose}
      className="btn btn-circle btn-ghost btn-sm"
      aria-label="Close"
    >
      <X className="size-5" aria-hidden="true" />
    </button>
  </div>
);

const MuteModal = ({
  conversationId,
  open,
  onClose,
}: {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}) => (
  <Modal open={open} onClose={onClose} labelledBy="mute-title" className={panel}>
    <DialogHeader id="mute-title" title="Mute notifications" onClose={onClose} />
    <ul className="space-y-1">
      {MUTE_OPTIONS.map((o) => (
        <li key={o.id}>
          <button
            type="button"
            className="w-full rounded-xl px-3 py-2 text-left hover:bg-base-content/5 focus-visible:bg-base-content/5"
            onClick={() => {
              void updatePrefs(conversationId, { muted_until: mutedUntilFor(o.ms) }).then(
                (ok) => ok && onClose(),
              );
            }}
          >
            {o.label}
          </button>
        </li>
      ))}
    </ul>
  </Modal>
);

const WallpaperModal = ({
  conversation,
  open,
  onClose,
}: {
  conversation: ConversationSummary;
  open: boolean;
  onClose: () => void;
}) => {
  const current = conversation.prefs.wallpaper;
  const pick = (id: string | null): void => {
    void updatePrefs(conversation.id, { wallpaper: id }).then((ok) => ok && onClose());
  };
  return (
    <Modal open={open} onClose={onClose} labelledBy="wallpaper-title" className={panel}>
      <DialogHeader id="wallpaper-title" title="Chat wallpaper" onClose={onClose} />
      <div className="grid grid-cols-3 gap-3" role="group" aria-label="Wallpapers">
        <button
          type="button"
          aria-pressed={current === null}
          onClick={() => {
            pick(null);
          }}
          className={cn(
            'app-bg grid h-16 place-items-center rounded-xl text-xs font-semibold ring-offset-2',
            current === null && 'ring-2 ring-primary',
          )}
        >
          Default
        </button>
        {WALLPAPERS.map((w) => (
          <button
            key={w.id}
            type="button"
            aria-pressed={current === w.id}
            aria-label={w.label}
            title={w.label}
            style={w.style}
            onClick={() => {
              pick(w.id);
            }}
            className={cn(
              'h-16 rounded-xl border border-base-content/10 ring-offset-2',
              current === w.id && 'ring-2 ring-primary',
            )}
          />
        ))}
      </div>
    </Modal>
  );
};

type Dialog = 'mute' | 'wallpaper' | 'lock-set' | 'lock-remove';

const Item = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-base-200 focus-visible:bg-base-200 focus-visible:outline-none"
  >
    {children}
  </button>
);

export const ChatOptionsMenu = ({
  conversation,
  onSearch,
}: {
  conversation: ConversationSummary;
  onSearch: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const select = useChatStore((s) => s.select);
  const relock = useLockStore((s) => s.relock);
  const { prefs, id } = conversation;

  const close = (): void => {
    setOpen(false);
  };
  useFocusTrap(menuRef, open, { onEscape: close });

  const act = (fn: () => void): (() => void) => {
    return () => {
      close();
      fn();
    };
  };
  const dialogItem = (d: Dialog) => act(() => setDialog(d));

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    items[(next + items.length) % items.length]?.focus();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        className="btn btn-circle btn-ghost btn-sm text-base-content/70 hover:text-primary"
        aria-label="Chat options"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Chat options"
      >
        <MoreVertical className="size-5" aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" aria-hidden="true" onClick={close} />
          <div
            ref={menuRef}
            role="menu"
            aria-label="Chat options"
            onKeyDown={onMenuKeyDown}
            className="glass-card absolute right-0 top-full z-40 mt-1 w-56 rounded-xl border border-base-content/10 p-1 shadow-xl"
          >
            <Item onClick={act(() => void updatePrefs(id, { pinned: !prefs.pinned }))}>
              {prefs.pinned ? 'Unpin chat' : 'Pin chat'}
            </Item>
            <Item
              onClick={act(() => {
                void updatePrefs(id, { archived: !prefs.archived }).then((ok) => {
                  if (ok && !prefs.archived) select(null);
                });
              })}
            >
              {prefs.archived ? 'Unarchive chat' : 'Archive chat'}
            </Item>
            <Item onClick={act(() => void updatePrefs(id, { favorite: !prefs.favorite }))}>
              {prefs.favorite ? 'Remove from favourites' : 'Add to favourites'}
            </Item>
            {isMuted(prefs) ? (
              <Item onClick={act(() => void updatePrefs(id, { muted_until: null }))}>Unmute</Item>
            ) : (
              <Item onClick={dialogItem('mute')}>Mute…</Item>
            )}
            <Item onClick={dialogItem('wallpaper')}>Wallpaper…</Item>
            {prefs.locked ? (
              <>
                <Item
                  onClick={act(() => {
                    relock(id);
                  })}
                >
                  Lock now
                </Item>
                <Item onClick={dialogItem('lock-remove')}>Remove chat lock…</Item>
              </>
            ) : (
              <Item onClick={dialogItem('lock-set')}>Lock chat…</Item>
            )}
            <Item onClick={act(onSearch)}>Search in chat</Item>
          </div>
        </>
      )}

      <MuteModal
        conversationId={id}
        open={dialog === 'mute'}
        onClose={() => {
          setDialog(null);
        }}
      />
      <WallpaperModal
        conversation={conversation}
        open={dialog === 'wallpaper'}
        onClose={() => {
          setDialog(null);
        }}
      />
      <LockModal
        conversation={conversation}
        mode={dialog === 'lock-remove' ? 'remove' : 'set'}
        open={dialog === 'lock-set' || dialog === 'lock-remove'}
        onClose={() => {
          setDialog(null);
        }}
      />
    </div>
  );
};

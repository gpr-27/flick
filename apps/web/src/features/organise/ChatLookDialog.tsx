import { Modal } from '@/components/ui';
import { ACCENTS, SOUNDS, playChatSound, setChatLook, useChatLook } from './chatLook';

/** Accent colour for your bubbles and a notification sound, for one chat. */
export const ChatLookDialog = ({
  conversationId,
  open,
  onClose,
}: {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}) => {
  const look = useChatLook(conversationId);
  return (
    <Modal open={open} onClose={onClose} label="Chat colour and sound" className="w-80 p-4">
      <h2 className="mb-2 font-semibold">Accent colour</h2>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-label="Default colour"
          aria-pressed={!look.accent}
          onClick={() => {
            setChatLook(conversationId, { ...(look.sound ? { sound: look.sound } : {}) });
          }}
          className="size-8 rounded-full border border-base-content/30 text-xs"
        >
          Off
        </button>
        {ACCENTS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Accent ${c}`}
            aria-pressed={look.accent === c}
            onClick={() => {
              setChatLook(conversationId, { ...look, accent: c });
            }}
            style={{ background: c }}
            className={`size-8 rounded-full ${look.accent === c ? 'ring-2 ring-offset-2 ring-base-content' : ''}`}
          />
        ))}
      </div>
      <h2 className="mt-4 mb-2 font-semibold">Notification sound</h2>
      <div className="flex flex-wrap gap-2">
        {SOUNDS.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={(look.sound ?? 'default') === s.value}
            onClick={() => {
              setChatLook(conversationId, { ...look, sound: s.value });
              playChatSound(s.value, 0.6);
            }}
            className={`btn btn-sm ${(look.sound ?? 'default') === s.value ? 'btn-primary' : 'btn-ghost'}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="mt-4 text-right">
        <button type="button" className="btn btn-sm" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
};

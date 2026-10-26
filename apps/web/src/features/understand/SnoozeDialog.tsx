import { notify } from '@/components/ui/notify';
import { isSnoozed, SNOOZE_PRESETS, useSnoozes } from './snooze';
import { Shell } from './UnderstandParts';
import { useChatStore } from '@/features/chat/useChatStore';

/** Snooze a chat until a preset time. A snoozed chat leaves the list until then. */
export const SnoozeDialog = ({
  conversationId,
  open,
  onClose,
}: {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}) => {
  const until = useSnoozes((s) => s.until);
  const snooze = useSnoozes((s) => s.snooze);
  const clear = useSnoozes((s) => s.clear);
  const select = useChatStore((s) => s.select);
  return (
    <Shell title="Snooze chat" open={open} onClose={onClose}>
      <p className="text-[var(--text-2)]">Hide this chat from your list until later.</p>
      <div className="flex flex-col gap-1">
        {SNOOZE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="btn btn-ghost min-h-[44px] justify-start"
            onClick={() => {
              snooze(conversationId, p.at(new Date()));
              notify.info(`Snoozed until ${p.label.toLowerCase()}.`);
              select(null);
              onClose();
            }}
          >
            {p.label}
          </button>
        ))}
        {isSnoozed(until, conversationId) && (
          <button
            type="button"
            className="btn btn-outline min-h-[44px]"
            onClick={() => {
              clear(conversationId);
              onClose();
            }}
          >
            Unsnooze
          </button>
        )}
      </div>
    </Shell>
  );
};

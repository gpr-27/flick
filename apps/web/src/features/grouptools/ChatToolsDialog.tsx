import { Markdown } from '@/features/content/richText/Markdown';
import { useState } from 'react';
import { CalendarClock, CheckSquare, Gamepad2, Map, Receipt, X } from 'lucide-react';
import { ENDPOINTS, type ConversationSummary, type MessageContent } from '@chat/contracts';
import { Button, Modal, notify } from '@/components/ui';
import { useAiEnabled } from '@/features/ai/useAiEnabled';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { sendMessage } from '../chat/outbox/useOutboxStore';
import { useChatStore } from '../chat/useChatStore';
import { parseAmount } from './expense';
import { WYR_PROMPTS, emptyBoard } from './games';
import { slotLabel, suggestSlots } from './meetingSlots';
import { saveToSaved } from './saveToSaved';

type View = 'menu' | 'checklist' | 'expense' | 'itinerary';

/** Make a checklist from lines of text: the title is optional, one item per line. */
export const ChecklistDialog = ({
  conversationId,
  initialItems = '',
  onClose,
}: {
  conversationId: string;
  initialItems?: string;
  onClose: () => void;
}) => {
  const myId = useSessionStore((s) => s.user?.id);
  const [title, setTitle] = useState('Checklist');
  const [items, setItems] = useState(initialItems);
  const lines = items
    .split('\n')
    .map((l) => l.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 50);
  const send = (): void => {
    if (!myId || lines.length === 0) return;
    sendMessage(myId, conversationId, {
      type: 'checklist',
      title: title.trim() || 'Checklist',
      items: lines.map((text) => ({ text, done: false })),
    });
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="checklist-title"
      className="glass-card mx-4 w-full max-w-sm rounded-3xl p-6 animate-scale-in"
    >
      <h2 id="checklist-title" className="mb-3 font-display text-lg font-bold">
        Make a shared checklist
      </h2>
      <input
        className="input-soft mb-2 w-full"
        aria-label="Checklist title"
        value={title}
        maxLength={100}
        onChange={(e) => {
          setTitle(e.target.value);
        }}
      />
      <textarea
        className="input-soft w-full"
        rows={6}
        aria-label="Items, one per line"
        placeholder="One item per line"
        value={items}
        onChange={(e) => {
          setItems(e.target.value);
        }}
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="gradient" disabled={lines.length === 0} onClick={send}>
          Send list ({lines.length})
        </Button>
      </div>
    </Modal>
  );
};

const ExpenseForm = ({
  conversationId,
  onDone,
}: {
  conversationId: string;
  onDone: () => void;
}) => {
  const myId = useSessionStore((s) => s.user?.id);
  const members = useChatStore((s) => s.members[conversationId]) ?? [];
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState(myId ?? '');
  const [split, setSplit] = useState<Set<string>>(() => new Set(members.map((m) => m.user.id)));
  const cents = parseAmount(amount);
  const ok = Boolean(myId && description.trim() && cents && payer && split.size > 0);
  const send = (): void => {
    if (!myId || !cents) return;
    sendMessage(myId, conversationId, {
      type: 'expense',
      description: description.trim(),
      amount_cents: cents,
      currency: 'USD',
      payer_id: payer,
      split_among: [...split],
    });
    onDone();
  };
  return (
    <div className="space-y-2">
      <input
        className="input-soft w-full"
        aria-label="What for"
        placeholder="What was it for?"
        value={description}
        maxLength={100}
        onChange={(e) => {
          setDescription(e.target.value);
        }}
      />
      <input
        className="input-soft w-full"
        aria-label="Amount"
        inputMode="decimal"
        placeholder="Amount, e.g. 42.50"
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
        }}
      />
      <label className="block text-sm">
        Paid by
        <select
          className="select select-bordered select-sm ml-2"
          value={payer}
          onChange={(e) => {
            setPayer(e.target.value);
          }}
        >
          {members.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.id === myId ? 'You' : m.user.display_name}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="text-sm font-semibold">Split between</legend>
        {members.map((m) => (
          <label key={m.user.id} className="flex items-center gap-2 py-0.5 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={split.has(m.user.id)}
              onChange={(e) => {
                const next = new Set(split);
                if (e.target.checked) next.add(m.user.id);
                else next.delete(m.user.id);
                setSplit(next);
              }}
            />
            {m.user.id === myId ? 'You' : m.user.display_name}
          </label>
        ))}
      </fieldset>
      <Button variant="gradient" disabled={!ok} onClick={send}>
        Add expense
      </Button>
    </div>
  );
};

const Itinerary = ({ conversationId }: { conversationId: string }) => {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const make = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await getApi().call(ENDPOINTS.groupTools.ai, {
        params: { conversation_id: conversationId },
        body: { task: 'itinerary' },
      });
      setText(res.text);
    } catch (error) {
      notify.error(getErrorMessage(error, "Couldn't make the itinerary."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <p className="mb-2 text-sm text-base-content/70">
        Flick reads the recent messages and collects dates, places and bookings into one card.
      </p>
      {text === null ? (
        <Button variant="gradient" loading={busy} onClick={() => void make()}>
          Make itinerary
        </Button>
      ) : (
        <>
          <Markdown
            text={text}
            className="scroll-slim mb-2 max-h-64 overflow-y-auto rounded-xl bg-base-content/5 p-3 text-sm"
          />
          <Button
            variant="gradient"
            onClick={() => {
              void saveToSaved(text).then(
                () => notify.success('Saved to your Saved messages'),
                (error: unknown) => notify.error(getErrorMessage(error, "Couldn't save it.")),
              );
            }}
          >
            Save to Saved messages
          </Button>
        </>
      )}
    </div>
  );
};

/** One place for the shared tools: find a time, checklist, expense split, games, trip itinerary. */
export const ChatToolsDialog = ({
  conversation,
  onClose,
}: {
  conversation: ConversationSummary;
  onClose: () => void;
}) => {
  const myId = useSessionStore((s) => s.user?.id);
  const aiOn = useAiEnabled();
  const [view, setView] = useState<View>('menu');
  const id = conversation.id;
  const isGroup = conversation.type === 'group';

  const send = (content: MessageContent): void => {
    if (!myId) return;
    sendMessage(myId, id, content);
    onClose();
  };

  if (view === 'checklist') return <ChecklistDialog conversationId={id} onClose={onClose} />;

  const item =
    'btn btn-ghost h-auto min-h-12 justify-start gap-3 rounded-xl px-3 py-2 text-left font-medium';
  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="chat-tools-title"
      className="glass-card mx-4 w-full max-w-sm rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="chat-tools-title" className="font-display text-lg font-bold">
          {view === 'expense'
            ? 'Split an expense'
            : view === 'itinerary'
              ? 'Trip itinerary'
              : 'Chat tools'}
        </h2>
        <button
          type="button"
          className="btn btn-circle btn-ghost btn-sm"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      {view === 'expense' && <ExpenseForm conversationId={id} onDone={onClose} />}
      {view === 'itinerary' && <Itinerary conversationId={id} />}
      {view === 'menu' && (
        <div className="flex flex-col">
          {isGroup && (
            <button
              type="button"
              className={item}
              onClick={() => {
                const slots = suggestSlots(new Date()).map(slotLabel);
                send({
                  type: 'poll',
                  question: 'Find a time: when can everyone meet?',
                  options: slots,
                  allow_multiple: true,
                });
              }}
            >
              <CalendarClock className="size-5" aria-hidden="true" />
              Find a time (5 suggested slots)
            </button>
          )}
          <button
            type="button"
            className={item}
            onClick={() => {
              setView('checklist');
            }}
          >
            <CheckSquare className="size-5" aria-hidden="true" />
            Make a checklist
          </button>
          {isGroup && (
            <button
              type="button"
              className={item}
              onClick={() => {
                setView('expense');
              }}
            >
              <Receipt className="size-5" aria-hidden="true" />
              Split an expense
            </button>
          )}
          <button
            type="button"
            className={item}
            onClick={() => {
              send({ type: 'game', game: 'tictactoe', state: { board: emptyBoard(), turn: 'x' } });
            }}
          >
            <Gamepad2 className="size-5" aria-hidden="true" />
            Play tic-tac-toe
          </button>
          <button
            type="button"
            className={item}
            onClick={() => {
              const pick = WYR_PROMPTS[Math.floor(Math.random() * WYR_PROMPTS.length)];
              if (!pick) return;
              send({ type: 'game', game: 'wyr', options: pick, state: {} });
            }}
          >
            <Gamepad2 className="size-5" aria-hidden="true" />
            Would you rather
          </button>
          {aiOn && (
            <button
              type="button"
              className={item}
              onClick={() => {
                setView('itinerary');
              }}
            >
              <Map className="size-5" aria-hidden="true" />
              Make itinerary from this chat
            </button>
          )}
        </div>
      )}
    </Modal>
  );
};

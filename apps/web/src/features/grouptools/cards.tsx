// Message cards for the shared-tool kinds: checklist, expense and game. Checklist and game state
// is read from and changed through the card endpoints, and re-read every few seconds
// (there is no live event for it yet, like polls).
import { stripMarkdown } from '@/features/content/richText/stripMarkdown';
import { useCallback, useEffect, useState } from 'react';
import { ENDPOINTS, type CardAction, type MessageContent } from '@chat/contracts';
import type { z } from 'zod';
import { cn, notify } from '@/components/ui';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { useChatStore, userName } from '@/features/chat/useChatStore';
import {
  canMove,
  emptyBoard,
  ticTacToeResult,
  wyrTally,
  type TicTacToeState,
  type WyrState,
} from './games';
import { formatMoney } from './expense';

type Of<T extends MessageContent['type']> = Extract<MessageContent, { type: T }>;
export interface CardMessage {
  id: string;
  conversationId: string;
}

const REFRESH_MS = 10_000;

/** The card's live content: starts as what was sent, then follows the server. */
function useCard<C>(initial: C, message: CardMessage | undefined) {
  const [content, setContent] = useState<C>(initial);
  const sent = message ? !message.id.startsWith('local:') : false;
  const params = message && { conversation_id: message.conversationId, message_id: message.id };

  useEffect(() => {
    if (!sent || !params) return;
    let alive = true;
    const load = (): void => {
      getApi()
        .call(ENDPOINTS.groupTools.card, { params })
        .then((res) => alive && setContent(res.content as C))
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sent, message?.id]);

  const act = useCallback(
    async (action: z.infer<typeof CardAction>): Promise<void> => {
      if (!params || !sent) return;
      try {
        const res = await getApi().call(ENDPOINTS.groupTools.cardAct, { params, body: action });
        setContent(res.content as C);
      } catch (error) {
        notify.error(getErrorMessage(error, "Couldn't do that."));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sent, message?.id],
  );
  return { content, act };
}

export const ChecklistView = ({
  card,
  message,
}: {
  card: Of<'checklist'>;
  message?: CardMessage;
}) => {
  const { content, act } = useCard(card, message);
  const done = content.items.filter((i) => i.done).length;
  return (
    <div className="min-w-52">
      <p className="font-semibold">{content.title}</p>
      <p className="mb-1 text-xs opacity-70">
        {done} of {content.items.length} done
      </p>
      <ul>
        {content.items.map((item, i) => (
          <li key={`${String(i)}-${item.text}`}>
            <label className="flex cursor-pointer items-center gap-2 py-0.5">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={item.done}
                onChange={() => void act({ op: 'toggle', index: i })}
              />
              <span className={cn(item.done && 'line-through opacity-60')}>{item.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const ExpenseView = ({ card }: { card: Of<'expense'> }) => {
  const users = useChatStore((s) => s.users);
  const myId = useSessionStore((s) => s.user?.id);
  const name = (id: string): string => (id === myId ? 'You' : userName(users, id));
  const each = Math.round(card.amount_cents / new Set(card.split_among).size);
  return (
    <div className="min-w-52">
      <p className="text-xs uppercase tracking-wide opacity-70">Expense</p>
      <p className="font-semibold">{stripMarkdown(card.description)}</p>
      <p className="text-xl font-bold">{formatMoney(card.amount_cents, card.currency)}</p>
      <p className="text-sm opacity-80">
        Paid by {name(card.payer_id)}, split between {new Set(card.split_among).size} (
        {formatMoney(each, card.currency)} each)
      </p>
    </div>
  );
};

const TicTacToe = ({ card, message }: { card: Of<'game'>; message?: CardMessage }) => {
  const { content, act } = useCard(card, message);
  const myId = useSessionStore((s) => s.user?.id) ?? '';
  const users = useChatStore((s) => s.users);
  const state = content.state as TicTacToeState;
  const board = state.board ?? emptyBoard();
  const result = ticTacToeResult(board);
  const mine = canMove(state, myId, state.solo === true);
  const who = (mark: 'x' | 'o'): string => {
    const id = state[mark];
    return id ? (id === myId ? 'You' : userName(users, id)) : 'Waiting';
  };
  const status = result
    ? result === 'draw'
      ? "It's a draw"
      : `${who(result)} won`
    : mine
      ? state.solo
        ? `Your move (${(state.turn ?? 'x').toUpperCase()})`
        : 'Your move'
      : `Waiting for ${who(state.turn ?? 'x')}`;
  return (
    <div>
      <p className="mb-1 text-sm font-semibold">Tic-tac-toe</p>
      <div className="grid w-36 grid-cols-3 gap-1">
        {board.map((mark, i) => (
          <button
            key={i}
            type="button"
            className="grid size-11 place-items-center rounded-lg bg-base-content/10 text-xl font-bold disabled:cursor-default"
            disabled={Boolean(mark) || !mine || !message}
            aria-label={`Square ${String(i + 1)}${mark ? `, ${mark.toUpperCase()}` : ''}`}
            onClick={() => void act({ op: 'move', cell: i })}
          >
            {mark.toUpperCase()}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs opacity-80">
        X: {who('x')} · O: {who('o')} · {status}
      </p>
    </div>
  );
};

const WouldYouRather = ({ card, message }: { card: Of<'game'>; message?: CardMessage }) => {
  const { content, act } = useCard(card, message);
  const myId = useSessionStore((s) => s.user?.id) ?? '';
  const state = content.state as WyrState;
  const tally = wyrTally(state);
  const total = tally.a + tally.b;
  const mine = state.votes?.[myId];
  const [a, b] = content.options ?? ['A', 'B'];
  return (
    <div className="min-w-52">
      <p className="mb-1 text-sm font-semibold">Would you rather…</p>
      {(['a', 'b'] as const).map((key) => (
        <button
          key={key}
          type="button"
          disabled={!message}
          onClick={() => void act({ op: 'vote', choice: key })}
          className={cn(
            'mb-1 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm',
            mine === key ? 'border-primary bg-primary/15' : 'border-base-content/20',
          )}
        >
          <span>{key === 'a' ? a : b}</span>
          <span className="text-xs opacity-70">
            {total ? Math.round((tally[key] / total) * 100) : 0}%
          </span>
        </button>
      ))}
      <p className="text-xs opacity-70">{total} votes</p>
    </div>
  );
};

export const GameView = ({ card, message }: { card: Of<'game'>; message?: CardMessage }) =>
  card.game === 'tictactoe' ? (
    <TicTacToe card={card} message={message} />
  ) : (
    <WouldYouRather card={card} message={message} />
  );

import { useState } from 'react';
import { Modal, Spinner } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { makeFlashcards } from './writingApi';

type Deck = Awaited<ReturnType<typeof makeFlashcards>>;

/**
 * Study helper: flashcards and a short quiz from this chat or from pasted notes. The cards live in
 * this dialog only; nothing is stored on the server or the device.
 */
export const StudyDialog = ({
  open,
  conversationId,
  onClose,
}: {
  open: boolean;
  conversationId: string;
  onClose: () => void;
}) => {
  const [notes, setNotes] = useState('');
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'cards' | 'quiz'>('cards');
  const [card, setCard] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [picked, setPicked] = useState<Record<number, number>>({});

  // Closing the dialog clears the deck (adjusted during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setDeck(null);
      setError(null);
      setPicked({});
      setCard(0);
      setFlipped(false);
    }
  }

  const make = (source: { conversation_id: string } | { text: string }): void => {
    setLoading(true);
    setError(null);
    makeFlashcards(source)
      .then((d) => {
        setDeck(d);
        setTab('cards');
      })
      .catch((e: unknown) => {
        setError(getErrorMessage(e, 'Could not make cards.'));
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const current = deck?.cards[card];
  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Study helper"
      overlayClassName="max-sm:items-end sm:p-4"
      className="w-full sm:w-[28rem]"
    >
      <div className="glass-card flex max-h-[85dvh] flex-col gap-3 overflow-y-auto rounded-t-3xl border border-base-content/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm shadow-2xl sm:rounded-2xl">
        <h2 className="text-base font-semibold">Study helper</h2>
        {!deck && (
          <>
            <button
              type="button"
              className="btn btn-primary h-12"
              disabled={loading}
              onClick={() => {
                make({ conversation_id: conversationId });
              }}
            >
              Make cards from this chat
            </button>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              Or paste notes or text from a PDF
              <textarea
                className="textarea textarea-bordered min-h-24 text-base font-normal"
                value={notes}
                maxLength={12_000}
                onChange={(e) => {
                  setNotes(e.target.value);
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-outline h-12"
              disabled={loading || !notes.trim()}
              onClick={() => {
                make({ text: notes });
              }}
            >
              Make cards from the notes
            </button>
            {loading && <Spinner size="sm" label="Making cards" />}
          </>
        )}
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        {deck && (
          <>
            <div role="tablist" className="flex gap-1.5">
              {(['cards', 'quiz'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className={`chip ${tab === t ? 'bg-primary !text-primary-content' : ''}`}
                  onClick={() => {
                    setTab(t);
                  }}
                >
                  {t === 'cards' ? `Cards (${deck.cards.length})` : `Quiz (${deck.quiz.length})`}
                </button>
              ))}
            </div>
            {tab === 'cards' && current && (
              <>
                <button
                  type="button"
                  className="min-h-32 rounded-2xl bg-sunken p-4 text-left text-base"
                  aria-label={
                    flipped ? 'Answer. Tap to see the question' : 'Question. Tap to see the answer'
                  }
                  onClick={() => {
                    setFlipped((f) => !f);
                  }}
                >
                  {flipped ? current.back : current.front}
                </button>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={card === 0}
                    onClick={() => {
                      setCard(card - 1);
                      setFlipped(false);
                    }}
                  >
                    Back
                  </button>
                  <span className="text-xs tabular-nums">
                    {card + 1} / {deck.cards.length}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={card >= deck.cards.length - 1}
                    onClick={() => {
                      setCard(card + 1);
                      setFlipped(false);
                    }}
                  >
                    Next
                  </button>
                </div>
              </>
            )}
            {tab === 'quiz' &&
              deck.quiz.map((q, qi) => (
                <fieldset key={qi} className="flex flex-col gap-1.5">
                  <legend className="mb-1 font-semibold">{q.question}</legend>
                  {q.options.map((o, oi) => {
                    const chosen = picked[qi];
                    const state =
                      chosen === undefined
                        ? ''
                        : oi === q.answer
                          ? 'border-success bg-success/10'
                          : oi === chosen
                            ? 'border-error bg-error/10'
                            : '';
                    return (
                      <button
                        key={oi}
                        type="button"
                        disabled={chosen !== undefined}
                        className={`btn btn-outline h-auto min-h-11 justify-start whitespace-normal py-2 text-left ${state}`}
                        onClick={() => {
                          setPicked((p) => ({ ...p, [qi]: oi }));
                        }}
                      >
                        {o}
                      </button>
                    );
                  })}
                </fieldset>
              ))}
            {tab === 'quiz' &&
              deck.quiz.length > 0 &&
              Object.keys(picked).length === deck.quiz.length && (
                <p role="status" className="font-semibold">
                  Score: {deck.quiz.filter((q, i) => picked[i] === q.answer).length} /{' '}
                  {deck.quiz.length}
                </p>
              )}
          </>
        )}
        <button type="button" className="btn btn-ghost h-12" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
};

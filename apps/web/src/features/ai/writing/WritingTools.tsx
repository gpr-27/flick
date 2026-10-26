import { lazy, Suspense, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  ListChecks,
  Sparkles,
  SpellCheck,
  Wand2,
} from 'lucide-react';
import type { AiComposeRequest, MessageContent } from '@chat/contracts';
import { cn, notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { composeText } from '../aiApi';
import { DictateButton } from './DictateButton';
import { draftPoll } from './writingApi';
import { countChanges } from './writingText';

const DoForMeDialog = lazy(() =>
  import('./DoForMeDialog').then((m) => ({ default: m.DoForMeDialog })),
);
const PlanDialog = lazy(() => import('./PlanDialog').then((m) => ({ default: m.PlanDialog })));
const StudyDialog = lazy(() => import('./StudyDialog').then((m) => ({ default: m.StudyDialog })));
const PollComposer = lazy(() =>
  import('@/features/content/polls/PollComposer').then((m) => ({ default: m.PollComposer })),
);

const chipClass =
  'chip shrink-0 cursor-pointer gap-1 whitespace-nowrap transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-[36px]';

type PollDraft = { question: string; options: string[] };

/**
 * More tools in the "Describe your message" bar: dictate, grammar check on demand, bullets to
 * message, simplify, "do it for me", plan, a poll from a question (groups) and the study helper.
 * The tools that rewrite go through the bar's own generate/undo.
 */
export const WritingTools = ({
  source,
  prompt,
  conversationId,
  isGroup,
  disabled,
  generate,
  apply,
  insert,
  onSendContent,
  doRequest,
  onDoClosed,
}: {
  /** The text in the box (or the current draft). */
  source: string;
  /** What is typed in the bar's field. */
  prompt: string;
  conversationId: string;
  isGroup: boolean;
  disabled: boolean;
  generate: (request: AiComposeRequest) => void;
  /** Puts an answer in the box as a new version. */
  apply: (answer: string) => void;
  /** Adds dictated text to the box. */
  insert: (text: string) => void;
  onSendContent?: (content: MessageContent) => void;
  /** "/do ..." typed in the bar: opens "Do it for me" with this text. */
  doRequest?: string | null;
  onDoClosed?: () => void;
}) => {
  const [grammar, setGrammar] = useState<
    { for: string; fixed: string; count: number } | 'checking' | null
  >(null);
  const [dialog, setDialog] = useState<'do' | 'plan' | 'study' | null>(null);
  const [request, setRequest] = useState('');
  const [poll, setPoll] = useState<PollDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const hasSource = source.trim() !== '';
  const ask = (prompt.trim() || source).trim();

  const checkGrammar = (): void => {
    setGrammar('checking');
    composeText({ mode: 'polish', text: source })
      .then((r) => {
        setGrammar({ for: source, fixed: r.text, count: countChanges(source, r.text) });
      })
      .catch((e: unknown) => {
        setGrammar(null);
        notify.error(getErrorMessage(e, 'Could not check the text.'));
      });
  };

  const makePoll = (): void => {
    setBusy(true);
    draftPoll(ask)
      .then((d) => {
        setPoll(d);
      })
      .catch((e: unknown) => {
        notify.error(getErrorMessage(e, 'Could not draft a poll.'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const open = (which: 'do' | 'plan'): void => {
    setRequest(ask);
    setDialog(which);
  };

  const fresh =
    typeof grammar === 'object' && grammar !== null && grammar.for === source ? grammar : null;

  return (
    <>
      <div
        role="group"
        aria-label="More writing tools"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5"
      >
        <DictateButton disabled={disabled} onText={insert} />
        {hasSource &&
          (fresh ? (
            fresh.count > 0 ? (
              <button
                type="button"
                className={cn(chipClass, '!bg-primary/10 !text-primary-text')}
                onClick={() => {
                  apply(fresh.fixed);
                  setGrammar(null);
                }}
              >
                <SpellCheck className="size-3.5" aria-hidden="true" />
                Fix {fresh.count} issue{fresh.count === 1 ? '' : 's'}
              </button>
            ) : (
              <span role="status" className="chip shrink-0">
                No issues found
              </span>
            )
          ) : (
            <button
              type="button"
              className={chipClass}
              disabled={disabled || grammar === 'checking'}
              onClick={checkGrammar}
            >
              <SpellCheck className="size-3.5" aria-hidden="true" />
              {grammar === 'checking' ? 'Checking…' : 'Check grammar'}
            </button>
          ))}
        {hasSource && (
          <>
            <button
              type="button"
              className={chipClass}
              disabled={disabled}
              onClick={() => {
                generate({ mode: 'bullets', text: source });
              }}
            >
              <ListChecks className="size-3.5" aria-hidden="true" />
              Bullets to message
            </button>
            <button
              type="button"
              className={chipClass}
              disabled={disabled}
              onClick={() => {
                generate({ mode: 'simplify', text: source });
              }}
            >
              <Sparkles className="size-3.5" aria-hidden="true" />
              Simplify
            </button>
          </>
        )}
        {ask && (
          <>
            <button
              type="button"
              className={chipClass}
              disabled={disabled}
              onClick={() => {
                open('do');
              }}
            >
              <Wand2 className="size-3.5" aria-hidden="true" />
              Do it for me
            </button>
            <button
              type="button"
              className={chipClass}
              disabled={disabled}
              onClick={() => {
                open('plan');
              }}
            >
              <CalendarCheck className="size-3.5" aria-hidden="true" />
              Plan
            </button>
            {isGroup && onSendContent && (
              <button
                type="button"
                className={chipClass}
                disabled={disabled || busy}
                onClick={makePoll}
              >
                <BarChart3 className="size-3.5" aria-hidden="true" />
                {busy ? 'Drafting…' : 'Poll from question'}
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className={chipClass}
          disabled={disabled}
          onClick={() => {
            setDialog('study');
          }}
        >
          <BookOpen className="size-3.5" aria-hidden="true" />
          Study
        </button>
      </div>
      <Suspense fallback={null}>
        {(dialog === 'do' || doRequest) && (
          <DoForMeDialog
            open
            request={doRequest ?? request}
            conversationId={conversationId}
            onClose={() => {
              setDialog(null);
              onDoClosed?.();
            }}
          />
        )}
        {dialog === 'plan' && (
          <PlanDialog
            open
            request={request}
            conversationId={conversationId}
            onUse={insert}
            onClose={() => {
              setDialog(null);
            }}
          />
        )}
        {dialog === 'study' && (
          <StudyDialog
            open
            conversationId={conversationId}
            onClose={() => {
              setDialog(null);
            }}
          />
        )}
        {poll && onSendContent && (
          <PollComposer
            open
            initial={poll}
            onClose={() => {
              setPoll(null);
            }}
            onCreate={(content) => {
              setPoll(null);
              onSendContent(content);
            }}
          />
        )}
      </Suspense>
    </>
  );
};

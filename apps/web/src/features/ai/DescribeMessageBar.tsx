import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  SlidersHorizontal,
  Undo2,
  X,
} from 'lucide-react';
import { LIMITS, type AiComposeRequest, type MessageContent } from '@chat/contracts';
import { cn } from '@/components/ui';
import { Markdown } from '@/features/content/richText/Markdown';
import { hasMarkdown } from '@/features/content/richText/stripMarkdown';
import { composeText } from './aiApi';
import {
  NO_VERSIONS,
  addVersion,
  currentVersion,
  placeResult,
  stepVersion,
  versionLabel,
  type ComposeApply,
  type Versions,
} from './composeVersions';
import {
  SETTINGS_TONES,
  prefsFields,
  readPrefs,
  readRecentPrompts,
  savePrefs,
  saveRecentPrompt,
  type ComposePrefs,
  type Length,
} from './composePrefs';
import { MAX_WRITE_PROMPT, flickInstruction } from './flickInstruction';
import { LANGUAGES } from './languages';
import { ModelTag } from './ModelTag';
import { SparklePenIcon } from './SparklePenIcon';
import { checkTone, type ToneResult } from './toneCheck';
import { useAiEnabled } from './useAiEnabled';
import { useAiTask } from './useAiTask';
import { WritingSettings } from './writing/WritingSettings';
import { WritingTools } from './writing/WritingTools';
import { useBackClose } from '@/lib/useBackClose';

type RefineRequest = Extract<AiComposeRequest, { mode: 'refine' }>;

const REFINE_CHIPS: readonly { action: RefineRequest['action']; label: string }[] = [
  { action: 'formalize', label: 'Formalize' },
  { action: 'elaborate', label: 'Elaborate' },
  { action: 'shorten', label: 'Shorten' },
  { action: 'casual', label: 'Make casual' },
  { action: 'friendly', label: 'Make friendly' },
  { action: 'grammar', label: 'Fix grammar' },
  { action: 'emojis', label: 'Add emojis' },
];

const REPLY_CHIPS = ['Say yes', 'Decline politely', 'Ask for time', 'Say thanks'] as const;

const TONE_LABEL: Record<(typeof SETTINGS_TONES)[number], string> = {
  casual: 'Casual',
  formal: 'Formal',
  friendly: 'Friendly',
};
const LENGTHS: readonly { value: Length; label: string }[] = [
  { value: 'shorter', label: 'Shorter' },
  { value: 'default', label: 'Default' },
  { value: 'longer', label: 'Longer' },
];

const chipClass =
  'chip shrink-0 cursor-pointer whitespace-nowrap transition-colors hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-[36px]';

/**
 * "Describe your message": a bar directly above the message box, like Gmail's "Help me write".
 * Enter turns the description into a draft in the box (never sent). Then the bar offers one-tap
 * changes (Formalize, Shorten, Translate ...), Retry, Undo and the earlier drafts. A reply can
 * also be drafted from the last messages of the chat.
 */
export const DescribeMessageBar = ({
  text,
  conversationId,
  canReply,
  initialPrompt,
  isGroup = false,
  onSendContent,
  onSetText,
  onClose,
}: {
  /** What is in the message box now. */
  text: string;
  conversationId: string;
  /** Whether the chat has messages from others to reply to. */
  canReply: boolean;
  /** Starts the field with this (the "/flick ..." command). */
  initialPrompt?: string;
  /** Groups get "Poll from question". */
  isGroup?: boolean;
  /** Sends a message content (the drafted poll). */
  onSendContent?: (content: MessageContent) => void;
  /** Puts text in the box. The bar never sends. */
  onSetText: (text: string) => void;
  onClose: () => void;
}) => {
  const enabled = useAiEnabled();
  useBackClose(true, onClose);
  const task = useAiTask();
  const inputRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [versions, setVersions] = useState<Versions>(NO_VERSIONS);
  // The box as it was before Flick wrote into it; Undo puts it back.
  const [base, setBase] = useState('');
  const [how, setHow] = useState<ComposeApply>('replace');
  const [kind, setKind] = useState<'write' | 'refine'>('write');
  const [last, setLast] = useState<AiComposeRequest | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ComposePrefs>(readPrefs);
  const [recent, setRecent] = useState<string[]>(readRecentPrompts);
  const [menu, setMenu] = useState<'settings' | 'languages' | null>(null);
  const [doText, setDoText] = useState<string | null>(null);
  const [toneResult, setToneResult] = useState<ToneResult | 'checking' | 'failed' | null>(null);

  const loading = task.state.status === 'loading';
  const offNote = enabled === false;
  const disabled = enabled !== true || loading;
  const hasSession = versions.items.length > 0;
  const current = currentVersion(versions);
  // The box was changed by hand after Flick wrote: then the box, not the draft, is what we work on.
  const edited = hasSession && text !== placeResult(base, current ?? '', how);
  const source = hasSession && !edited && current !== null ? current : text;
  const hasSource = source.trim() !== '';
  const sourceTooLong = source.length > LIMITS.MAX_TEXT_LENGTH;
  // The text the box held before Flick, ignoring an "@flick ..." instruction line.
  const boxBase = flickInstruction(text) === null ? text : '';
  const choose = hasSession && base.trim() !== '' && kind === 'write';

  const commit = (
    answer: string,
    nextBase: string,
    nextHow: ComposeApply,
    from: Versions,
  ): void => {
    const placed = placeResult(nextBase, answer, nextHow);
    if (answer.length > LIMITS.MAX_TEXT_LENGTH || placed.length > LIMITS.MAX_TEXT_LENGTH) {
      setProblem(
        `That is longer than the ${LIMITS.MAX_TEXT_LENGTH.toLocaleString('en-US')} character limit. Try again.`,
      );
      return;
    }
    setBase(nextBase);
    setHow(nextHow);
    setVersions(addVersion(from, answer));
    onSetText(placed);
  };

  const generate = async (
    request: AiComposeRequest,
    nextKind: 'write' | 'refine',
  ): Promise<void> => {
    if (disabled) return;
    setProblem(null);
    setMenu(null);
    setToneResult(null);
    setLast(request);
    // Refining the box from outside a session (or after a hand edit) replaces the box.
    const fresh = !hasSession;
    const nextBase = fresh ? boxBase : base;
    const nextHow: ComposeApply =
      nextKind === 'refine'
        ? fresh || edited
          ? 'replace'
          : how
        : nextBase.trim()
          ? 'insert'
          : 'replace';
    const answer = await task.run(async ({ signal, onModel }) => {
      const result = await composeText(request, signal);
      onModel(result.model);
      return result.text;
    });
    if (answer === null) return;
    setKind(nextKind);
    commit(answer, nextBase, nextHow, fresh ? NO_VERSIONS : versions);
  };

  const refine = (
    action: RefineRequest['action'],
    extra: Partial<Pick<RefineRequest, 'language' | 'instruction'>> = {},
  ): void => {
    if (!hasSource || sourceTooLong) return;
    void generate({ mode: 'refine', text: source, action, ...extra }, 'refine');
  };

  const draftFrom = (instruction: string): void => {
    const clean = instruction.trim();
    if (!clean) return;
    saveRecentPrompt(clean);
    setRecent(readRecentPrompts());
    void generate(
      {
        mode: 'write',
        text: clean,
        ...(boxBase.trim() ? { draft: boxBase } : {}),
        ...prefsFields(prefs),
      },
      'write',
    );
  };

  const replyTo = (hint?: string): void => {
    void generate(
      {
        mode: 'reply',
        conversation_id: conversationId,
        ...(hint ? { text: hint } : {}),
        ...(boxBase.trim() ? { draft: boxBase } : {}),
        ...prefsFields(prefs),
      },
      'write',
    );
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const clean = prompt.trim();
    if (!clean || disabled) return;
    if (/^\/do\s/i.test(clean)) {
      // "/do remind me Friday 6pm to call mom": handled by the "Do it for me" chip's dialog.
      setPrompt('');
      setDoText(clean.replace(/^\/do\s+/i, ''));
      return;
    }
    setPrompt('');
    if (hasSession) {
      // Once a draft exists, what is typed here says what to change in it.
      if (!hasSource || sourceTooLong) return;
      refine('custom', { instruction: clean });
    } else {
      draftFrom(clean);
    }
  };

  const retry = (): void => {
    if (last) void generate(last, kind);
  };

  const undo = (): void => {
    task.reset();
    onSetText(base);
    setVersions(NO_VERSIONS);
    setProblem(null);
    setToneResult(null);
    inputRef.current?.focus();
  };

  const step = (delta: -1 | 1): void => {
    const next = stepVersion(versions, delta);
    const draft = currentVersion(next);
    if (draft === null) return;
    setVersions(next);
    onSetText(placeResult(base, draft, how));
  };

  const chooseHow = (next: ComposeApply): void => {
    setHow(next);
    if (current !== null) onSetText(placeResult(base, current, next));
  };

  const changePrefs = (next: ComposePrefs): void => {
    setPrefs(next);
    savePrefs(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (menu) setMenu(null);
    else onClose();
  };

  const runToneCheck = (): void => {
    setToneResult('checking');
    checkTone(source)
      .then(setToneResult)
      .catch(() => {
        setToneResult('failed');
      });
  };

  const showSuggestions = !hasSession && !prompt.trim();
  const replyChips = canReply ? REPLY_CHIPS : [];

  return (
    <div
      role="group"
      aria-label="Describe your message"
      onKeyDown={onKeyDown}
      className="mb-2 flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-2 shadow-[var(--shadow-1)]"
    >
      <form onSubmit={submit} className="relative flex items-center gap-1">
        <div
          className={cn(
            'flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-full bg-sunken px-3 transition-shadow focus-within:shadow-[0_0_0_3px_oklch(var(--p)/0.22)]',
            loading && 'skeleton-line !rounded-full',
          )}
          aria-busy={loading}
        >
          <SparklePenIcon className="size-5 shrink-0 text-primary-text" />
          <input
            ref={inputRef}
            type="text"
            autoFocus
            value={prompt}
            maxLength={MAX_WRITE_PROMPT}
            disabled={enabled !== true}
            onChange={(e) => {
              setPrompt(e.target.value);
            }}
            aria-label="Describe your message"
            placeholder={hasSession ? 'Tell Flick what to change' : 'Describe your message'}
            className="min-w-0 flex-1 bg-transparent py-2 text-base text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)] sm:text-sm"
          />
          <button
            type="submit"
            disabled={disabled || !prompt.trim()}
            aria-label={hasSession ? 'Change the draft' : 'Create draft'}
            title="Enter"
            className="btn btn-circle btn-ghost btn-xs shrink-0 text-primary-text disabled:opacity-40 max-sm:size-9"
          >
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setMenu((m) => (m === 'settings' ? null : 'settings'));
          }}
          aria-label="Tone and length"
          aria-expanded={menu === 'settings'}
          aria-haspopup="dialog"
          className={cn(
            'btn btn-circle btn-ghost btn-sm min-h-[44px] min-w-[44px]',
            menu === 'settings' ? 'text-primary-text' : 'text-[var(--text-2)]',
          )}
        >
          <SlidersHorizontal className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Write with Flick"
          className="btn btn-circle btn-ghost btn-sm min-h-[44px] min-w-[44px] text-[var(--text-2)]"
        >
          <X className="size-5" aria-hidden="true" />
        </button>

        {menu === 'settings' && (
          <div
            role="dialog"
            aria-label="Tone and length"
            className="glass-card absolute right-0 top-full z-30 mt-1 flex w-64 max-w-full flex-col gap-3 rounded-2xl p-3 text-sm shadow-[var(--shadow-2)]"
          >
            <div role="group" aria-label="Tone" className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[var(--text-2)]">Tone</span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  aria-pressed={prefs.tone === null}
                  onClick={() => {
                    changePrefs({ ...prefs, tone: null });
                  }}
                  className={cn(
                    chipClass,
                    prefs.tone === null && 'bg-primary !text-primary-content',
                  )}
                >
                  Default
                </button>
                {SETTINGS_TONES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={prefs.tone === t}
                    onClick={() => {
                      changePrefs({ ...prefs, tone: t });
                    }}
                    className={cn(
                      chipClass,
                      prefs.tone === t && 'bg-primary !text-primary-content',
                    )}
                  >
                    {TONE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
            <div role="group" aria-label="Length" className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[var(--text-2)]">Length</span>
              <div className="flex flex-wrap gap-1.5">
                {LENGTHS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    aria-pressed={prefs.length === l.value}
                    onClick={() => {
                      changePrefs({ ...prefs, length: l.value });
                    }}
                    className={cn(
                      chipClass,
                      prefs.length === l.value && 'bg-primary !text-primary-content',
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-[var(--text-3)]">Used when Flick writes a new message.</p>
            <WritingSettings conversationId={conversationId} />
          </div>
        )}
      </form>

      {offNote && (
        <p role="status" className="px-1 text-sm">
          AI is not set up on this server.
        </p>
      )}

      {showSuggestions && (replyChips.length > 0 || recent.length > 0 || canReply) && (
        <div
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5"
          aria-label="Suggestions"
          role="group"
        >
          {canReply && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                replyTo();
              }}
              className={cn(chipClass, '!bg-primary/10 !text-primary-text')}
            >
              Reply to this…
            </button>
          )}
          {replyChips.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={disabled}
              onClick={() => {
                replyTo(chip);
              }}
              className={chipClass}
            >
              {chip}
            </button>
          ))}
          {recent.map((p) => (
            <button
              key={p}
              type="button"
              disabled={disabled}
              title="Recent prompt"
              onClick={() => {
                setPrompt(p);
                inputRef.current?.focus();
              }}
              className={cn(chipClass, 'max-w-[14rem] truncate')}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <WritingTools
        source={source}
        prompt={prompt}
        conversationId={conversationId}
        isGroup={isGroup}
        disabled={disabled}
        generate={(request) => {
          void generate(request, 'refine');
        }}
        apply={(answer) => {
          commit(answer, hasSession ? base : boxBase, hasSession ? how : 'replace', versions);
        }}
        insert={(t) => {
          onSetText(boxBase.trim() ? `${boxBase.trimEnd()} ${t}` : t);
        }}
        onSendContent={onSendContent}
        doRequest={doText}
        onDoClosed={() => {
          setDoText(null);
        }}
      />

      {hasSource && (
        <div className="relative">
          <div
            role="group"
            aria-label="Change the draft"
            className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5"
          >
            {REFINE_CHIPS.map((c) => (
              <button
                key={c.action}
                type="button"
                disabled={disabled || sourceTooLong}
                onClick={() => {
                  refine(c.action);
                }}
                className={chipClass}
              >
                {c.label}
              </button>
            ))}
            <button
              type="button"
              disabled={disabled || sourceTooLong}
              aria-haspopup="menu"
              aria-expanded={menu === 'languages'}
              onClick={() => {
                setMenu((m) => (m === 'languages' ? null : 'languages'));
              }}
              className={chipClass}
            >
              Translate…
            </button>
            <button
              type="button"
              disabled={disabled || sourceTooLong || toneResult === 'checking'}
              onClick={runToneCheck}
              className={chipClass}
            >
              Check tone
            </button>
          </div>
          {menu === 'languages' && (
            <div
              role="menu"
              aria-label="Translate to"
              className="glass-card absolute bottom-full left-0 z-30 mb-1 flex max-w-full flex-wrap gap-1.5 rounded-2xl p-2 shadow-[var(--shadow-2)]"
            >
              {LANGUAGES.map((language) => (
                <button
                  key={language}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    refine('translate', { language });
                  }}
                  className={chipClass}
                >
                  {language}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {sourceTooLong && (
        <p role="alert" className="px-1 text-xs text-error">
          The message is too long to improve.
        </p>
      )}

      {toneResult === 'checking' && (
        <p role="status" className="px-1 text-xs">
          Checking the tone…
        </p>
      )}
      {toneResult === 'failed' && (
        <p role="alert" className="px-1 text-xs text-error">
          Could not check the tone. Try again.
        </p>
      )}
      {typeof toneResult === 'object' && toneResult?.ok && (
        <p role="status" className="px-1 text-xs">
          Sounds fine to me.
        </p>
      )}
      {typeof toneResult === 'object' && toneResult && !toneResult.ok && (
        <div role="status" className="rounded-xl bg-warning/10 p-2 text-xs">
          {toneResult.note && <Markdown text={toneResult.note} />}
          {toneResult.softer && <Markdown text={toneResult.softer} className="mt-1 italic" />}
          <button
            type="button"
            className="btn btn-xs btn-primary mt-2"
            onClick={() => {
              const softer = toneResult.softer ?? source;
              commit(softer, hasSession ? base : boxBase, hasSession ? how : 'replace', versions);
              setToneResult(null);
            }}
          >
            Use softer version
          </button>
        </div>
      )}

      {loading && (
        <p role="status" className="px-1 text-xs text-[var(--text-2)]">
          Flick is writing…
        </p>
      )}
      {problem && (
        <p role="alert" className="px-1 text-xs text-error">
          {problem}
        </p>
      )}
      {task.state.status === 'error' && !task.state.notConfigured && (
        <p role="alert" className="flex flex-wrap items-center gap-2 px-1 text-xs text-error">
          {task.state.error}
          {last && (
            <button type="button" className="font-semibold underline" onClick={retry}>
              Try again
            </button>
          )}
        </p>
      )}
      {task.state.notConfigured && (
        <p role="status" className="px-1 text-xs">
          AI is not set up on this server.
        </p>
      )}

      {hasSession && current !== null && hasMarkdown(current) && (
        <div
          aria-label="Draft preview"
          className="max-h-40 overflow-y-auto rounded-xl bg-sunken px-3 py-2 text-sm"
        >
          <Markdown text={current} />
        </div>
      )}

      {hasSession && (
        <div className="flex flex-wrap items-center gap-1.5">
          {choose && (
            <div role="group" aria-label="Where the draft goes" className="flex gap-1">
              {(['insert', 'replace'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={how === option}
                  disabled={loading}
                  onClick={() => {
                    chooseHow(option);
                  }}
                  className={cn(chipClass, how === option && 'bg-primary !text-primary-content')}
                >
                  {option === 'insert' ? 'Insert' : 'Replace'}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            disabled={loading || !last}
            onClick={retry}
            className={cn(chipClass, 'gap-1')}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Retry
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={undo}
            className={cn(chipClass, 'gap-1')}
          >
            <Undo2 className="size-3.5" aria-hidden="true" />
            Undo
          </button>
          {versionLabel(versions) && (
            <div className="ml-auto flex items-center gap-0.5 text-xs text-[var(--text-2)]">
              <button
                type="button"
                aria-label="Previous version"
                disabled={loading || versions.index === 0}
                onClick={() => {
                  step(-1);
                }}
                className="btn btn-circle btn-ghost btn-xs disabled:opacity-40 max-sm:size-9"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </button>
              <span aria-live="polite" className="tabular-nums">
                {versionLabel(versions)}
              </span>
              <button
                type="button"
                aria-label="Next version"
                disabled={loading || versions.index === versions.items.length - 1}
                onClick={() => {
                  step(1);
                }}
                className="btn btn-circle btn-ghost btn-xs disabled:opacity-40 max-sm:size-9"
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}

      <p className="px-1 text-[11px] text-[var(--text-3)]">
        AI can make mistakes. Check the draft before you send it.
      </p>
      {hasSession && <ModelTag label={task.state.model} className="px-1" />}
    </div>
  );
};

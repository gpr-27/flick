// Draws a chat message as rich text. Everything is built as React elements from the parser's
// data (React escapes all text), so message text can never inject HTML. Links must be
// http, https or mailto.
import { ExplainCode } from '@/features/ai/writing/ExplainCode';
import { Fragment, createElement, useMemo, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/components/ui';
import { ChatLink } from './ChatLink';
import { LinkWarning } from '@/features/safety/LinkWarning';
import { assessLink } from '@/features/safety/linkSafety';
import { chatLinkId } from './chatLinkId';
import { safeHref } from './safeHref';
import { parseBlocks, type Align, type Block } from './parse';

export type RenderText = (text: string) => ReactNode;

// One alternative per inline construct, tried left to right:
// 1 escaped character, 2 `code`, 3-4 [text](url), 5 **bold**, 6 ~~strike~~, 7 *italic*, 8 bare URL
const INLINE = new RegExp(
  [
    '\\\\([\\\\`*_{}\\[\\]()#+\\-.!|~>])',
    '`([^`\\n]+)`',
    '\\[([^\\]\\n]+)\\]\\(([^\\s)]+)\\)',
    '\\*\\*(\\S(?:[^\\n]*?\\S)?)\\*\\*(?!\\*)',
    '~~(\\S(?:[^\\n]*?\\S)?)~~',
    '\\*([^*\\s](?:[^*\\n]*[^*\\s])?)\\*',
    'https?://[^\\s<>]+',
  ].join('|'),
  'g',
);

/** A bare URL without the punctuation that ends the sentence around it. */
const trimUrl = (url: string): string => {
  let end = url.length;
  while (end > 0) {
    const c = url[end - 1] ?? '';
    if (/[.,;:!?'"]/.test(c) || (c === ')' && !url.slice(0, end).includes('('))) end--;
    else break;
  }
  return url.slice(0, end);
};

const Link = ({ href, children }: { href: string; children: ReactNode }) => {
  const [warning, setWarning] = useState(false);
  const risk = useMemo(() => assessLink(href), [href]);
  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="link link-primary break-all"
        onClick={(e) => {
          if (risk.level === 'ok') return;
          e.preventDefault();
          setWarning(true);
        }}
      >
        {children}
      </a>
      {warning && (
        <LinkWarning
          href={href}
          risk={risk}
          onClose={() => {
            setWarning(false);
          }}
        />
      )}
    </>
  );
};

const renderInline = (
  text: string,
  renderText: RenderText | undefined,
  links = true,
  keyPrefix = '',
): ReactNode[] => {
  const out: ReactNode[] = [];
  const plain = (s: string, key: string): void => {
    if (s) out.push(<Fragment key={key}>{renderText ? renderText(s) : s}</Fragment>);
  };
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const key = `${keyPrefix}${n++}`;
    let end = m.index + m[0].length;
    let node: ReactNode;
    if (m[1] !== undefined) {
      node = m[1];
    } else if (m[2] !== undefined) {
      node = (
        <code className="rounded bg-base-content/10 px-1 py-0.5 font-mono text-[0.9em]">
          {m[2]}
        </code>
      );
    } else if (m[3] !== undefined && m[4] !== undefined) {
      const href = links ? safeHref(m[4]) : null;
      const chatId = links ? chatLinkId(m[4]) : null;
      // An unsafe or nested link stays visible as the text the sender typed.
      node = chatId ? (
        <ChatLink id={chatId}>{renderInline(m[3], renderText, false, `${key}l`)}</ChatLink>
      ) : href ? (
        <Link href={href}>{renderInline(m[3], renderText, false, `${key}l`)}</Link>
      ) : (
        m[0]
      );
    } else if (m[5] !== undefined) {
      node = <strong>{renderInline(m[5], renderText, links, `${key}b`)}</strong>;
    } else if (m[6] !== undefined) {
      node = <del>{renderInline(m[6], renderText, links, `${key}s`)}</del>;
    } else if (m[7] !== undefined) {
      node = <em>{renderInline(m[7], renderText, links, `${key}i`)}</em>;
    } else {
      const url = trimUrl(m[0]);
      end = m.index + url.length;
      const href = links ? safeHref(url) : null;
      node = href ? <Link href={href}>{url}</Link> : url;
    }
    plain(text.slice(last, m.index), `${key}t`);
    out.push(<Fragment key={key}>{node}</Fragment>);
    last = end;
    // matchAll continues after the full match; a trimmed URL leaves its tail as plain text.
  }
  plain(text.slice(last), `${keyPrefix}end`);
  return out;
};

const CodeBlock = ({ code, lang }: { code: string; lang: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 1500);
      },
      () => undefined,
    );
  };
  return (
    <div className="max-w-full overflow-hidden rounded-xl bg-black/25 text-left" dir="ltr">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1 text-[11px] opacity-80">
        <span>{lang || 'code'}</span>
        <ExplainCode code={code} />
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10"
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="size-3" aria-hidden="true" />
          ) : (
            <Copy className="size-3" aria-hidden="true" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 pb-3 text-[13px] leading-snug">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
};

const HEADING_SIZE = {
  1: 'text-2xl',
  2: 'text-xl',
  3: 'text-lg',
  4: 'text-base',
  5: 'text-sm',
  6: 'text-xs uppercase tracking-wide',
} as const;

const ALIGN_CLASS: Record<NonNullable<Align>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

const renderBlock = (b: Block, key: number, renderText: RenderText | undefined): ReactNode => {
  const inline = (s: string): ReactNode[] => renderInline(s, renderText);
  switch (b.kind) {
    case 'heading':
      return createElement(
        `h${b.level}`,
        { key, dir: 'auto', className: cn('font-bold leading-snug', HEADING_SIZE[b.level]) },
        inline(b.text),
      );
    case 'para':
      return (
        <p key={key} dir="auto" className="whitespace-pre-wrap [overflow-wrap:anywhere]">
          {inline(b.text)}
        </p>
      );
    case 'code':
      return <CodeBlock key={key} code={b.code} lang={b.lang} />;
    case 'hr':
      return <hr key={key} className="border-current opacity-30" />;
    case 'quote':
      return (
        <blockquote key={key} className="space-y-2 border-s-4 border-current/40 ps-3 opacity-90">
          {b.blocks.map((inner, i) => renderBlock(inner, i, renderText))}
        </blockquote>
      );
    case 'list':
      return createElement(
        b.ordered ? 'ol' : 'ul',
        {
          key,
          ...(b.ordered ? { start: b.start } : {}),
          className: cn('space-y-1 ps-5', b.ordered ? 'list-decimal' : 'list-disc'),
        },
        b.items.map((item, i) => (
          <li key={i} dir="auto" className={cn(item.task !== null && 'list-none -ms-5')}>
            {item.task !== null && (
              <input
                type="checkbox"
                checked={item.task}
                disabled
                readOnly
                aria-label={item.task ? 'Done' : 'Not done'}
                className="checkbox checkbox-xs me-2 align-middle"
              />
            )}
            <div className={cn('space-y-1', item.task !== null && 'inline-block align-top')}>
              {item.blocks.map((inner, j) => renderBlock(inner, j, renderText))}
            </div>
          </li>
        )),
      );
    case 'table':
      return (
        <div key={key} className="max-w-full overflow-x-auto rounded-lg border border-current/20">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead className="bg-base-content/10">
              <tr>
                {b.head.map((cell, i) => (
                  <th
                    key={i}
                    scope="col"
                    dir="auto"
                    className={cn(
                      'border-b border-current/20 px-3 py-1.5 font-bold',
                      ALIGN_CLASS[b.aligns[i] ?? 'left'],
                    )}
                  >
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r} className="even:bg-base-content/5">
                  {row.map((cell, i) => (
                    <td
                      key={i}
                      dir="auto"
                      className={cn(
                        'border-t border-current/10 px-3 py-1.5 align-top',
                        ALIGN_CLASS[b.aligns[i] ?? 'left'],
                      )}
                    >
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
};

/**
 * The text of a message. Plain text (no block markdown) keeps the exact look it always had: one
 * paragraph with line breaks kept. `renderText` draws the plain parts, e.g. to highlight @mentions.
 */
export const RichText = ({ text, renderText }: { text: string; renderText?: RenderText }) => {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  if (blocks.every((b) => b.kind === 'para')) {
    return (
      <p
        dir="auto"
        className="whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-relaxed"
      >
        {renderInline(text, renderText)}
      </p>
    );
  }
  return (
    <div className="min-w-0 max-w-full space-y-2 [overflow-wrap:anywhere] text-[15px] leading-relaxed">
      {blocks.map((b, i) => renderBlock(b, i, renderText))}
    </div>
  );
};

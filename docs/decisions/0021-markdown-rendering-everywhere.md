# ADR-0021: One safe Markdown renderer for messages and AI text

- **Status:** Accepted (2026-10-27)
- **Related:** ADR-0016

## Context

People write `**bold**`, lists, code and tables in messages, and AI answers arrive as Markdown. Showing raw symbols looks
broken, but rendering Markdown with a general library that can output HTML is an XSS risk: a message is untrusted text
from another person (or from a model that read untrusted text).

## Decision

- A small GFM-subset **parser** (`features/content/richText/parse.ts`) turns text into plain data: headings, paragraphs,
  fenced code, quotes, rules, ordered, bullet, nested and task lists, and pipe tables, plus inline bold, italic,
  strikethrough, code and links. A **renderer** turns that data into React elements. **Raw HTML from a message is never
  used**, so there is no `dangerouslySetInnerHTML` path.
- Links pass `safeHref`: only `http:`, `https:` and `mailto:` become links; they open with `rel="noopener noreferrer"`.
  Chat links (invite and message links) get their own handling.
- The same renderer is used **everywhere text appears**: chat bubbles, AI answers and dialogs (`Markdown` component),
  previews, notes, the Flick panel and cards. Places that need one plain line (chat list, reply quote, notifications) use
  `stripMarkdown`, so symbols are dropped, not shown.
- Nesting depth is capped (8) and deeper content shows as text, so a hostile message cannot blow up rendering.
- Search stores and matches the raw text; snippets are HTML-escaped on the server and `<mark>` is the only markup.
- Link colours inside bubbles are tokens with checked contrast (see the design system).

## Alternatives

- **A full Markdown library plus an HTML sanitiser.** More features, a larger bundle and a bigger attack surface.
- **Plain text only.** Safe, but AI answers and long messages become hard to read.

## Trade-offs

Only a subset is supported (no images, no raw HTML, no footnotes). Tables are rendered but wide tables scroll.

## Consequences

- Tests cover the parser and renderer (`RichText.test.tsx`, `stripMarkdown.test.ts`).
- Docs: [`../features/rich-messages.md`](../features/rich-messages.md).

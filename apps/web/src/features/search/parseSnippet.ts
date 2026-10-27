// A search snippet from the server is escaped text where <mark>...</mark> is the only markup.
// We never put it in the DOM as HTML: it is split on the mark tags and drawn as React text, so
// even a snippet containing a raw "<img onerror=...>" shows up as harmless text.

import { stripMarkdown } from '@/features/content/richText/stripMarkdown';

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
};

/** Undo the server's HTML escaping so the text reads normally (React escapes it again). */
export const decodeEntities = (text: string): string =>
  text.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (m) => ENTITIES[m] ?? m);

export interface SnippetPart {
  text: string;
  marked: boolean;
}

const OPEN = '\uE000';
const CLOSE = '\uE001';

export const parseSnippet = (snippet: string): SnippetPart[] => {
  // Mark tags become private characters so the markdown symbols can be dropped around them
  // (a snippet is one plain line; the chat bubble keeps the formatting).
  const flat = stripMarkdown(
    decodeEntities(snippet.replace(/<mark>/g, OPEN).replace(/<\/mark>/g, CLOSE)),
  );
  const parts: SnippetPart[] = [];
  let marked = false;
  for (const piece of flat.split(/([\uE000\uE001])/)) {
    if (piece === OPEN) marked = true;
    else if (piece === CLOSE) marked = false;
    else if (piece) parts.push({ text: piece, marked });
  }
  return parts;
};

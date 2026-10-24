const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;

/** The first http(s) link in a text, without trailing punctuation. */
export const firstUrl = (text: string): string | null => {
  const match = URL_PATTERN.exec(text);
  return match ? match[0].replace(/[.,;:!?)\]]+$/, '') : null;
};

export interface TextPart {
  text: string;
  /** Set when this part is a link (always http or https). */
  href?: string;
}

const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

/** Cuts a text into plain parts and http(s) links, so links can be drawn as anchors. */
export const splitLinks = (text: string): TextPart[] => {
  const parts: TextPart[] = [];
  const pattern = new RegExp(URL_PATTERN.source, 'gi');
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const link = match[0].replace(TRAILING_PUNCTUATION, '');
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: link, href: link });
    last = match.index + link.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
};

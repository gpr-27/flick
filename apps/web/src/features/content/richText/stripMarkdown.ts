// Turns markdown into one line of plain text, for previews, banners, titles and aria-labels.
// Chat bubbles keep the markdown and render it; this is only for single-line surfaces.

const INLINE: [RegExp, string][] = [
  [/!\[([^\]\n]*)\]\([^)\s]*\)/g, '$1'],
  [/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1'],
  [/`([^`\n]+)`/g, '$1'],
  [/\*\*(\S(?:[^\n]*?\S)?)\*\*/g, '$1'],
  [/~~(\S(?:[^\n]*?\S)?)~~/g, '$1'],
  [/(?<![\w*])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?![\w*])/g, '$1'],
  [/(?<!\w)__(\S(?:[^\n]*?\S)?)__(?!\w)/g, '$1'],
  [/\\([\\`*_{}[\]()#+\-.!|~>])/g, '$1'],
];

export const stripMarkdown = (text: string): string => {
  if (!text) return '';
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => !/^\s{0,3}(?:`{3,}|~{3,})/.test(l))
    .filter((l) => !/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(l))
    .filter((l) => !(l.includes('|') && l.includes('-') && /^[\s|:-]+$/.test(l)))
    .map((l) => {
      const row = /^\s*\|/.test(l);
      const t = l
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s{0,3}(?:>\s?)+/, '')
        .replace(/^\s*(?:[-*+•]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/, '');
      return row
        ? t
            .replace(/^\s*\|\s*/, '')
            .replace(/\s*\|\s*$/, '')
            .replace(/\s*\|\s*/g, ' · ')
        : t;
    });
  let out = lines.join(' ');
  for (const [re, rep] of INLINE) out = out.replace(re, rep);
  return out.replace(/\s+/g, ' ').trim();
};

/** Whether the text has any markdown worth drawing (so a plain text needs no preview). */
export const hasMarkdown = (text: string): boolean =>
  /(\*\*\S|~~\S|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|>|```))/m.test(
    text,
  );

export type PreviewKind = 'pdf' | 'text' | null;

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'log', 'xml', 'yml', 'yaml']);

/** What the preview dialog can show for a file name; anything else just downloads. */
export const previewKindFor = (fileName: string): PreviewKind => {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  return TEXT_EXTENSIONS.has(ext) ? 'text' : null;
};

/** The first ~2KB of a text file, cut at a line end where possible. */
export const firstChunk = (text: string, max = 2048): string => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastBreak = cut.lastIndexOf('\n');
  return `${lastBreak > max / 2 ? cut.slice(0, lastBreak) : cut}\n...`;
};

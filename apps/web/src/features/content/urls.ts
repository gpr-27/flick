const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;

/** The first http(s) link in a text, without trailing punctuation. */
export const firstUrl = (text: string): string | null => {
  const match = URL_PATTERN.exec(text);
  return match ? match[0].replace(/[.,;:!?)\]]+$/, '') : null;
};

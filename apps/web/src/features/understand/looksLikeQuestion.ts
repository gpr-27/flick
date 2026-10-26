const QUESTION =
  /^(what|when|where|who|why|how|which|did|do|does|is|are|was|were|can|could|will)\b/i;

/** True for "when is the meeting?" style searches: three or more words that read like a question. */
export const looksLikeQuestion = (q: string): boolean =>
  q.trim().split(/\s+/).length >= 3 && (q.trim().endsWith('?') || QUESTION.test(q.trim()));

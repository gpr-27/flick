// The text a "Share to Flick" opens the app with: title, text and url joined, empties dropped.
export const sharedTextFrom = (search: string): string => {
  const params = new URLSearchParams(search);
  const parts = ['title', 'text', 'url'].map((k) => params.get(k)?.trim() ?? '');
  // Many apps put the link in both text and url: keep it once.
  return parts.filter((p, i) => p && parts.indexOf(p) === i).join('\n');
};

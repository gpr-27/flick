const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** The link as the browser would read it, or null when it is not an http/https/mailto link. */
export const safeHref = (raw: string): string | null => {
  try {
    const url = new URL(raw.trim());
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

/**
 * A random unique id. crypto.randomUUID only exists in secure contexts
 * (HTTPS / localhost), so plain-HTTP LAN testing falls back to a timestamp id.
 */
export const randomId = (): string => {
  const c: Partial<Pick<Crypto, 'randomUUID'>> = globalThis.crypto;
  return c.randomUUID
    ? c.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

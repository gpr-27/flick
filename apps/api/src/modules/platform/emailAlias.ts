/**
 * The address a person forwards mail to so it lands in their Saved messages: `<username>@<domain>`.
 * POST /inbound/email looks the user up by the part before the `@`, so the alias is the username.
 * Returns null (feature hidden) unless both the inbound secret and the domain are configured.
 */
export function emailAliasFor(
  username: string | null | undefined,
  secret: string | undefined,
  domain: string | undefined,
): string | null {
  const d = domain?.trim().replace(/^@/, '').toLowerCase();
  if (!secret || !d || !username) return null;
  // The inbound handler only matches [A-Za-z0-9._-]+ before the @.
  if (!/^[A-Za-z0-9._-]+$/.test(username)) return null;
  return `${username.toLowerCase()}@${d}`;
}

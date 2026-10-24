import ipaddr from 'ipaddr.js';

/**
 * Address policy for outbound preview fetches.
 *
 * The policy is "deny unless plainly global unicast":
 *   1. ipaddr.js must classify the address as `unicast` (anything it puts in a
 *      special range — loopback, private, linkLocal, carrierGradeNat,
 *      reserved, multicast, ipv4Mapped, rfc6052 (NAT64), uniqueLocal, 6to4,
 *      teredo, ... — is refused), AND
 *   2. it must not fall in any of the explicit CIDRs below. The explicit list
 *      duplicates most of ipaddr.js on purpose so that a library update that
 *      reclassifies a range cannot silently open a hole, AND
 *   3. IPv6 must sit inside 2000::/3, the only block IANA allocates for
 *      global unicast.
 *
 * IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64
 * (64:ff9b::/96, 64:ff9b:1::/48), 6to4 and Teredo addresses are refused
 * outright instead of being unwrapped: a legitimate public site never needs
 * them, and unwrapping is where most SSRF filters go wrong.
 */
const BLOCKED_V4_CIDRS: readonly string[] = [
  '0.0.0.0/8', // "this network", includes 0.0.0.0
  '10.0.0.0/8', // RFC1918
  '100.64.0.0/10', // CGNAT (RFC6598)
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local, includes 169.254.169.254 cloud metadata
  '172.16.0.0/12', // RFC1918
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // TEST-NET-1 (documentation)
  '192.88.99.0/24', // 6to4 relay anycast (deprecated)
  '192.168.0.0/16', // RFC1918
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // TEST-NET-2 (documentation)
  '203.0.113.0/24', // TEST-NET-3 (documentation)
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved (class E)
  '255.255.255.255/32', // broadcast
];

const BLOCKED_V6_CIDRS: readonly string[] = [
  '::/128', // unspecified
  '::1/128', // loopback
  '::/96', // IPv4-compatible (deprecated)
  '::ffff:0:0/96', // IPv4-mapped
  '::ffff:0:0:0/96', // IPv4-translated (RFC6145)
  '64:ff9b::/96', // NAT64 well-known prefix
  '64:ff9b:1::/48', // NAT64 local-use prefix
  '100::/64', // discard-only
  '2001::/32', // Teredo
  '2001:2::/48', // benchmarking
  '2001:10::/28', // ORCHID (deprecated)
  '2001:20::/28', // ORCHIDv2
  '2001:db8::/32', // documentation
  '2002::/16', // 6to4
  '3fff::/20', // documentation (RFC9637)
  '5f00::/16', // SRv6 SIDs
  'fc00::/7', // unique local (ULA)
  'fe80::/10', // link-local
  'fec0::/10', // site-local (deprecated)
  'ff00::/8', // multicast
];

const GLOBAL_UNICAST_V6 = ipaddr.parseCIDR('2000::/3');

type ParsedCidr = [ipaddr.IPv4 | ipaddr.IPv6, number];

const parsedV4 = BLOCKED_V4_CIDRS.map((c): ParsedCidr => ipaddr.parseCIDR(c));
const parsedV6 = BLOCKED_V6_CIDRS.map((c): ParsedCidr => ipaddr.parseCIDR(c));

export type AddressFamily = 4 | 6;

/** Strict parse: only canonical dotted-quad IPv4 or valid IPv6 text. */
export function parseIpLiteral(input: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  let text = input;
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  // Zone IDs (fe80::1%eth0) have no business in a public URL.
  if (text.includes('%')) return null;
  if (ipaddr.IPv4.isValidFourPartDecimal(text)) return ipaddr.IPv4.parse(text);
  if (ipaddr.IPv6.isValid(text)) return ipaddr.IPv6.parse(text);
  return null;
}

/** True when `address` could plausibly be an IP literal, in any spelling. */
export function looksLikeIp(input: string): boolean {
  let text = input;
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  return ipaddr.isValid(text);
}

function inAny(addr: ipaddr.IPv4 | ipaddr.IPv6, cidrs: readonly ParsedCidr[]): boolean {
  for (const [range, bits] of cidrs) {
    if (addr.kind() === range.kind() && addr.match(range, bits)) return true;
  }
  return false;
}

/**
 * Returns true when connecting to `address` must be refused.
 * Unparseable input is blocked (fail closed).
 */
export function isBlockedAddress(address: string): boolean {
  const addr = parseIpLiteral(address);
  if (addr === null) {
    // Non-canonical spellings (octal, hex, short forms) are never produced by
    // the resolver; if one shows up, refuse it rather than guess.
    return true;
  }
  if (addr.range() !== 'unicast') return true;
  if (addr.kind() === 'ipv4') return inAny(addr, parsedV4);
  if (inAny(addr, parsedV6)) return true;
  return !addr.match(GLOBAL_UNICAST_V6);
}

/** Loopback check used only by the explicit test-only allowlist. */
export function isLoopbackAddress(address: string): boolean {
  const addr = parseIpLiteral(address);
  return addr !== null && addr.range() === 'loopback';
}

export function familyOf(address: string): AddressFamily | null {
  const addr = parseIpLiteral(address);
  if (addr === null) return null;
  return addr.kind() === 'ipv4' ? 4 : 6;
}

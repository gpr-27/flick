import { describe, expect, it } from 'vitest';
import { isBlockedAddress } from '../src/ip.js';

/** One representative IPv4 address per blocked range (start, middle, end where useful). */
const BLOCKED_V4: Record<string, string[]> = {
  'this-network 0.0.0.0/8': ['0.0.0.0', '0.1.2.3', '0.255.255.255'],
  'loopback 127/8': ['127.0.0.1', '127.1.2.3', '127.255.255.254'],
  'RFC1918 10/8': ['10.0.0.1', '10.255.255.255'],
  'RFC1918 172.16/12': ['172.16.0.1', '172.20.10.10', '172.31.255.255'],
  'RFC1918 192.168/16': ['192.168.0.1', '192.168.255.254'],
  'link-local 169.254/16': ['169.254.0.1', '169.254.169.254', '169.254.255.255'],
  'CGNAT 100.64/10': ['100.64.0.1', '100.100.100.200', '100.127.255.255'],
  'multicast 224/4': ['224.0.0.1', '233.252.0.1', '239.255.255.255'],
  'reserved 240/4': ['240.0.0.1', '250.1.2.3'],
  broadcast: ['255.255.255.255'],
  'IETF 192.0.0/24': ['192.0.0.8'],
  'documentation TEST-NET-1': ['192.0.2.1'],
  'documentation TEST-NET-2': ['198.51.100.7'],
  'documentation TEST-NET-3': ['203.0.113.9'],
  'benchmarking 198.18/15': ['198.18.0.1', '198.19.255.254'],
};

const BLOCKED_V6_NATIVE: Record<string, string[]> = {
  unspecified: ['::'],
  loopback: ['::1', '0:0:0:0:0:0:0:1'],
  'ULA fc00::/7': ['fc00::1', 'fd12:3456:789a::1', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
  'link-local fe80::/10': ['fe80::1', 'fe80::a00:27ff:fe4e:66a1', 'febf::1'],
  'site-local fec0::/10': ['fec0::1'],
  'multicast ff00::/8': ['ff02::1', 'ff05::2', 'ff0e::1'],
  'documentation 2001:db8::/32': ['2001:db8::1', '2001:db8:ffff::1'],
  'documentation 3fff::/20': ['3fff::1'],
  'NAT64 local 64:ff9b:1::/48': ['64:ff9b:1::1'],
  'discard 100::/64': ['100::1'],
  'Teredo 2001::/32': ['2001:0:4136:e378:8000:63bf:3fff:fdd2'],
  '6to4 2002::/16': ['2002:c000:0204::1', '2002:7f00:1::1'],
  'benchmarking 2001:2::/48': ['2001:2::1'],
  ORCHIDv2: ['2001:20::1'],
  'outside 2000::/3': ['4000::1', '1000::1'],
};

const ALLOWED = [
  '8.8.8.8',
  '1.1.1.1',
  '93.184.216.34',
  '172.15.255.255',
  '172.32.0.1',
  '100.63.255.255',
  '100.128.0.1',
  '2606:4700:4700::1111',
  '2001:4860:4860::8888',
  '2a00:1450:4001:80b::200e',
];

/** The same IPv4 address dressed up as IPv6: mapped, mapped (hex), compatible, NAT64, translated. */
function v6Forms(v4: string): string[] {
  const [a = 0, b = 0, c = 0, d = 0] = v4.split('.').map(Number);
  const hi = ((a << 8) | b).toString(16);
  const lo = ((c << 8) | d).toString(16);
  return [
    `::ffff:${v4}`,
    `::ffff:${hi}:${lo}`,
    `0:0:0:0:0:ffff:${hi}:${lo}`,
    `::${v4}`,
    `64:ff9b::${v4}`,
    `64:ff9b::${hi}:${lo}`,
    `::ffff:0:${v4}`,
  ];
}

describe('isBlockedAddress', () => {
  // One test per range, so a failure names the range.
  it('blocks every IPv4 range, also wrapped in IPv6 forms', () => {
    for (const addrs of Object.values(BLOCKED_V4)) {
      for (const v4 of addrs) {
        expect(isBlockedAddress(v4), v4).toBe(true);
        for (const v6 of v6Forms(v4)) expect(isBlockedAddress(v6), v6).toBe(true);
      }
    }
  });

  it('blocks every native IPv6 range', () => {
    for (const addrs of Object.values(BLOCKED_V6_NATIVE)) {
      for (const v6 of addrs) expect(isBlockedAddress(v6), v6).toBe(true);
    }
  });

  it('blocks public IPv4 when wrapped in IPv6 transition forms too', () => {
    for (const v6 of ['::ffff:8.8.8.8', '64:ff9b::8.8.8.8', '::8.8.8.8']) {
      expect(isBlockedAddress(v6)).toBe(true);
    }
  });

  it('fails closed on non-canonical or non-IP input', () => {
    for (const input of [
      '0x7f000001',
      '2130706433',
      '0177.0.0.1',
      '127.1',
      'localhost',
      '',
      '[::1]',
    ]) {
      expect(isBlockedAddress(input), input).toBe(true);
    }
  });

  it('allows public unicast addresses', () => {
    for (const address of ALLOWED) expect(isBlockedAddress(address), address).toBe(false);
  });
});

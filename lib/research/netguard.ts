import dns from "node:dns/promises";
import net from "node:net";

/** The eight 16-bit groups of an IPv6 address (expanding `::` and a dotted IPv4 tail), or null when it is not one. */
function ipv6Groups(a: string): number[] | null {
  let s = a.replace(/%.*$/, "");
  const dotted = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) { const [p, q, r, t] = dotted.slice(1).map(Number); s = s.slice(0, s.length - dotted[0].length) + ((p << 8) | q).toString(16) + ":" + ((r << 8) | t).toString(16); }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [], tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail].map((x) => parseInt(x, 16));
  return groups.length === 8 && groups.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? groups : null;
}

/** True for addresses a public web page should never resolve to: loopback, private, link-local (cloud metadata), CGNAT, multicast, reserved. */
export function isPrivateAddress(addr: string): boolean {
  const a = addr.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIPv4(a)) {
    const [p, q] = a.split(".").map(Number);
    return p === 0 || p === 10 || p === 127 || (p === 100 && q >= 64 && q <= 127) || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 192 && q === 0) || (p === 198 && (q === 18 || q === 19)) || p >= 224;
  }
  if (net.isIPv6(a)) {
    const g = ipv6Groups(a);
    if (!g) return true;
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    // IPv4 carried inside an IPv6 address (::ffff:a.b.c.d in either spelling, 6to4 2002:a.b.c.d::/16): judged as the IPv4 address it carries
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateAddress(v4(g[6], g[7]));
    if (g[0] === 0x2002) return isPrivateAddress(v4(g[1], g[2]));
    const first = g[0];
    return g.every((x) => x === 0) || (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) // :: and ::1
      || (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 // link-local, and the old site-local range
      || (first & 0xfe00) === 0xfc00 || (first & 0xff00) === 0xff00 // unique-local, multicast
      || (first === 0x64 && g[1] === 0xff9b); // NAT64
  }
  return true; // not an address we understand
}

/** Refuses a host that is, or resolves to, a private address. The lookup and the later fetch are two steps (a host could change in between), so this narrows the risk rather than closing it. */
export async function publicHostOnly(host: string, lookup: (h: string) => Promise<{ address: string }[]> = (h) => dns.lookup(h, { all: true })): Promise<string | null> {
  if (net.isIP(host.replace(/^\[|\]$/g, ""))) return isPrivateAddress(host) ? "that address is not public" : null;
  try {
    const addrs = await lookup(host);
    if (!addrs.length) return "the host does not resolve";
    return addrs.some((x) => isPrivateAddress(x.address)) ? "the host resolves to a private address" : null;
  } catch { return "the host does not resolve"; }
}

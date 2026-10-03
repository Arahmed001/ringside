import dns from "node:dns/promises";
import net from "node:net";

/** True for addresses a public web page should never resolve to: loopback, private, link-local (cloud metadata), CGNAT, multicast, reserved. */
export function isPrivateAddress(addr: string): boolean {
  const a = addr.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIPv4(a)) {
    const [p, q] = a.split(".").map(Number);
    return p === 0 || p === 10 || p === 127 || (p === 100 && q >= 64 && q <= 127) || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 192 && q === 0) || (p === 198 && (q === 18 || q === 19)) || p >= 224;
  }
  if (net.isIPv6(a)) {
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return a === "::" || a === "::1" || a.startsWith("fe8") || a.startsWith("fe9") || a.startsWith("fea") || a.startsWith("feb") || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("ff") || a.startsWith("64:ff9b:");
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

/**
 * Who is asking, for the per-visitor limits (the AI limit, sign-in and sign-up, the public API's 60 a minute).
 *
 * By default the address is the first entry of X-Forwarded-For, then X-Real-IP, which is right behind a proxy that overwrites them. Some hosts do not
 * promise that: Fly.io, for one, adds its own entry to X-Forwarded-For and says nothing about one the visitor sent, and the first entry is the visitor's.
 * Those hosts do set a header of their own that a visitor cannot choose (Fly: `Fly-Client-IP`). Set CLIENT_IP_HEADER to its name and that header alone is
 * used. If it is set and a request arrives without it (it did not come through the host's proxy), there is no address, so the request shares the one
 * bucket of everyone unidentified; it never falls back to a header the visitor can write.
 */
export function clientAddress(headers: Pick<Headers, "get">): string | null {
  const own = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (own) return /^[a-z0-9-]{1,64}$/.test(own) ? headers.get(own)?.trim().slice(0, 64) || null : null;
  const xff = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (xff || headers.get("x-real-ip")?.trim() || null)?.slice(0, 64) ?? null;
}

import { SESSION_COOKIE, SESSION_DAYS, userForToken, type Role, type User } from "./users";
import { clientId, sameOrigin } from "./guard";

/** Shared plumbing for the account routes: JSON in and out, the session cookie, and the checks every state-changing request goes through. */
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
export const fail = (error: string, status = 400, headers: Record<string, string> = {}) => json({ error }, status, headers);

export function cookieOf(req: Pick<Request, "headers">, name = SESSION_COOKIE): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return undefined; } // a malformed value is no sign-in, not a server error
    }
  }
  return undefined;
}

const secure = (req: Pick<Request, "headers">) => (process.env.SITE_URL ?? "").startsWith("https://") || req.headers.get("x-forwarded-proto") === "https";
export const sessionCookie = (req: Pick<Request, "headers">, token: string, expires: Date) =>
  `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}; Max-Age=${SESSION_DAYS * 86400}${secure(req) ? "; Secure" : ""}`;
export const clearCookie = (req: Pick<Request, "headers">) => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure(req) ? "; Secure" : ""}`;

export const userOf = (req: Pick<Request, "headers">): User | null => userForToken(cookieOf(req));
export const canReview = (u: User | null): u is User => !!u && (u.role === "editor" || u.role === "admin");
export const isRole = (u: User | null, ...roles: Role[]): u is User => !!u && roles.includes(u.role);

const MAX_BODY = 16 * 1024;

/** The body as text, read no further than `max` bytes: a request that says (or turns out) to be larger is refused without buffering the rest. */
async function readBodyCapped(req: Request, max: number): Promise<string | "too_large" | "bad"> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return "too_large";
  if (!req.body) return "";
  const reader = req.body.getReader(), dec = new TextDecoder("utf-8", { fatal: false });
  let out = "", bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) { await reader.cancel().catch(() => {}); return "too_large"; }
      out += dec.decode(value, { stream: true });
    }
  } catch { return "bad"; }
  return out + dec.decode();
}

/** Same-origin check, then the body as a JSON object (at most 16 KB, counted in bytes as it arrives), or a ready-made error response. */
export async function postBody(req: Request): Promise<{ body: Record<string, unknown>; ip: string } | Response> {
  if (!sameOrigin(req)) return fail("forbidden", 403);
  const ip = clientId(req.headers);
  const text = await readBodyCapped(req, MAX_BODY);
  if (text === "too_large") return fail("too_large", 413);
  if (text === "bad") return fail("bad_request");
  if (!text.trim()) return { body: {}, ip };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("bad_request");
    return { body: body as Record<string, unknown>, ip };
  } catch { return fail("bad_request"); }
}
export const str = (v: unknown, max = 400) => (typeof v === "string" ? v.slice(0, max) : "");

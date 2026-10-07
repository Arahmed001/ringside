import { clientId } from "../ai-guard";
import { APPEALS_PER_USER, EDITS_PER_USER, POSTS_PER_ADDRESS, POSTS_PER_USER, THREADS_PER_USER } from "../forum/rules";

/**
 * Small protections every account endpoint shares.
 *  - sameOrigin: a state-changing request must come from this site. Browsers always send Origin on a POST, so a form on another site is refused;
 *    a request with neither Origin nor Sec-Fetch-Site is not from a browser (curl, a script) and CSRF does not apply to it.
 *  - RateLimiter: a sliding window per key, in memory (one process; behind several instances each has its own window).
 */
export function sameOrigin(req: Pick<Request, "headers" | "url">, siteUrl = process.env.SITE_URL): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    let host: string;
    try { host = new URL(origin).host; } catch { return false; }
    const own = new Set<string>();
    const h = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (h) own.add(h);
    try { own.add(new URL(req.url).host); } catch { /* ignore */ }
    if (siteUrl) { try { own.add(new URL(siteUrl).host); } catch { /* ignore */ } }
    return own.has(host);
  }
  const site = req.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(readonly max: number, readonly windowMs: number, private maxKeys = 5000) {}
  /** Records an attempt and says whether it is allowed. */
  take(key: string, at = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => at - t < this.windowMs);
    const ok = recent.length < this.max;
    if (ok) recent.push(at);
    this.hits.delete(key); this.hits.set(key, recent);
    while (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value as string);
    return ok;
  }
  /** Attempts left in the window, without recording one. */
  left(key: string, at = Date.now()): number { return Math.max(0, this.max - (this.hits.get(key) ?? []).filter((t) => at - t < this.windowMs).length); }
  clear(key: string) { this.hits.delete(key); }
  reset() { this.hits.clear(); }
}

export { clientId };

/** Limits, shared by the routes. Failed logins are counted per address and per name, so one attacker cannot lock out everyone and one name cannot be ground down from many addresses. */
const g = globalThis as unknown as { __accountLimits?: { loginIp: RateLimiter; loginName: RateLimiter; signup: RateLimiter; hashing: RateLimiter; write: RateLimiter; contribute: RateLimiter; report: RateLimiter; check: RateLimiter; forumPost: RateLimiter; forumPostIp: RateLimiter; forumThread: RateLimiter; forumEdit: RateLimiter; forumReport: RateLimiter; forumAppeal: RateLimiter } };
export const limits = () => (g.__accountLimits ??= {
  loginIp: new RateLimiter(20, 15 * 60_000), loginName: new RateLimiter(6, 15 * 60_000), signup: new RateLimiter(5, 60 * 60_000), hashing: new RateLimiter(240, 60_000),
  forumPost: new RateLimiter(POSTS_PER_USER.max, POSTS_PER_USER.windowMs), forumPostIp: new RateLimiter(POSTS_PER_ADDRESS.max, POSTS_PER_ADDRESS.windowMs), forumThread: new RateLimiter(THREADS_PER_USER.max, THREADS_PER_USER.windowMs), forumEdit: new RateLimiter(EDITS_PER_USER.max, EDITS_PER_USER.windowMs), forumReport: new RateLimiter(20, 24 * 60 * 60_000), forumAppeal: new RateLimiter(APPEALS_PER_USER.max, APPEALS_PER_USER.windowMs),
  write: new RateLimiter(120, 60_000), contribute: new RateLimiter(10, 24 * 60 * 60_000), report: new RateLimiter(10, 24 * 60 * 60_000), check: new RateLimiter(30, 60 * 60_000),
});

/**
 * Password hashing is deliberately expensive (32 MB and tens of milliseconds each), so the endpoints that do it share one site-wide budget on top
 * of the per-address and per-name limits (an attacker who can fake an address header would otherwise get a fresh allowance each time and could
 * keep every worker busy). Over budget the request is refused before any hashing starts.
 */
export const hashingAllowed = () => limits().hashing.take("all");

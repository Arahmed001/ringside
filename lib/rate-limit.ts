/**
 * A fixed-window limiter by key (an address): `hit(key)` says whether this request is allowed and, when it is not, how many seconds until the window ends. In memory,
 * per process: enough to stop one client hammering a read-only endpoint, not a defence against many (that is the proxy's job). The table is bounded: expired windows
 * are dropped as they are found, and at `maxKeys` the oldest go, so a flood of distinct addresses cannot grow it without end.
 */
export interface Limiter { hit(key: string): { ok: boolean; remaining: number; retryAfterSec: number } }
export function makeLimiter(opts: { limit: number; windowMs: number; maxKeys?: number; now?: () => number }): Limiter {
  const { limit, windowMs, maxKeys = 10_000, now = Date.now } = opts;
  const table = new Map<string, { start: number; n: number }>();
  return {
    hit(key) {
      const t = now(), cur = table.get(key);
      if (!cur || t - cur.start >= windowMs) {
        if (table.size >= maxKeys) {
          for (const [k, v] of table) if (t - v.start >= windowMs) table.delete(k);
          while (table.size >= maxKeys) table.delete(table.keys().next().value as string);
        }
        table.set(key, { start: t, n: 1 });
        return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
      }
      cur.n++;
      return cur.n <= limit ? { ok: true, remaining: limit - cur.n, retryAfterSec: 0 } : { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((cur.start + windowMs - t) / 1000)) };
    },
  };
}

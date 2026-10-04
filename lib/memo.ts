import type { World } from "./world";

/**
 * Kept on `globalThis`, not in a module variable: Next compiles the start-up hook (instrumentation.ts) and the pages as separate bundles, each with
 * its own copy of this module, so a module-level cache made everything lib/warm.ts computed at start-up invisible to the pages (the world itself
 * was shared through globalThis, its aggregates were not). Found in round 31 by logging what a first visitor's request computes.
 */
const g = globalThis as unknown as { __ringsideMemo?: WeakMap<World, Map<string, unknown>> };
const cache = (g.__ringsideMemo ??= new WeakMap<World, Map<string, unknown>>());

/**
 * A per-key cache that every bundle shares, for the indexes built over a world (fighter names for search and Ask) that are kept in a WeakMap of their own
 * rather than through `memo`. Same reason as above: a module-level WeakMap is a different one in the start-up hook and in the pages, so the warm-up built
 * an index the first visitor's request could not see and built again (about 150 ms at 19,000 fighters).
 */
export function sharedWeakMap<K extends WeakKey, V>(name: string): WeakMap<K, V> {
  const reg = ((globalThis as unknown as { __ringsideShared?: Map<string, WeakMap<WeakKey, unknown>> }).__ringsideShared ??= new Map());
  let m = reg.get(name);
  if (!m) { m = new WeakMap(); reg.set(name, m); }
  return m as WeakMap<K, V>;
}

/**
 * Whole-league aggregates (analytics, judge and referee tables, trainer leaderboards) are pure functions of a World,
 * and a World is never modified after it is built, so each is computed once per world instead of once per page view.
 * A rebuilt world is a new object, so every result starts afresh with it and the old ones are garbage-collected.
 * Results are shared between callers: treat them as read-only (copy before sorting).
 */
export function memo<T>(w: World, key: string, compute: () => T): T {
  let m = cache.get(w);
  if (!m) { m = new Map(); cache.set(w, m); }
  if (m.has(key)) return m.get(key) as T;
  const v = LOG ? timed(key, compute) : compute();
  m.set(key, v);
  return v;
}

/** The keys computed so far for a world: what a test (or a person with RINGSIDE_MEMO_LOG) can ask to see what has been paid for. */
export const memoKeys = (w: World): string[] => [...(cache.get(w)?.keys() ?? [])];

/**
 * Tooling, off by default: with RINGSIDE_MEMO_LOG=1 every aggregate that takes 5 ms or more to compute is logged once, as a JSON line on stderr, with the
 * time it took itself (`ms`, without the aggregates it needed) and in all (`totalMs`). Run a server with it and visit a page to see exactly what
 * the first visitor to that page waits for, then give `lib/warm.ts` the ones that are too slow to leave to a visitor.
 */
const LOG = process.env.RINGSIDE_MEMO_LOG === "1";
const children: number[] = [];
function timed<T>(key: string, compute: () => T): T {
  children.push(0);
  const t0 = performance.now();
  try { return compute(); } finally {
    const total = performance.now() - t0, kids = children.pop() ?? 0;
    if (children.length) children[children.length - 1] += total;
    if (total - kids >= 5) console.error(JSON.stringify({ event: "memo", key, ms: Math.round(total - kids), totalMs: Math.round(total) }));
  }
}

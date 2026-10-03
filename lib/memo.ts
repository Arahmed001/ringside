import type { World } from "./world";

const cache = new WeakMap<World, Map<string, unknown>>();

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
  const v = compute();
  m.set(key, v);
  return v;
}

import { getDb, dbVersion } from "../db";
import type { Locale } from "./config";
import type { Names } from "./t";
import { composedNames } from "./name-words";

const cache = globalThis as unknown as { __names?: Record<string, { key: string; map: Names }> };

/**
 * Proper names in another language, keyed by the exact English spelling (so "Marcus Brightwell" the fighter and
 * the trainer share one row). They live in their own table, not on the fighter rows, so they survive every
 * re-ingest, and each row records who wrote it and whether a person has reviewed it.
 */
/** English has no table of translated names, and callers key caches on the table they were handed (the fighter search keeps its index per table), so every call shares this one. */
export const NO_NAMES: Names = ((globalThis as unknown as { __ringsideNoNames?: Names }).__ringsideNoNames ??= Object.freeze({}) as Names); // one object for every bundle: indexes are kept per table

export async function getNames(locale: Locale): Promise<Names> {
  if (locale === "en") return NO_NAMES;
  const db = await getDb();
  const key = dbVersion(db);
  const hit = cache.__names?.[locale];
  if (hit?.key === key) return hit.map;
  const map: Names = {};
  for (const r of db.prepare("SELECT en, text FROM name_translations WHERE locale = ?").all(locale) as { en: string; text: string }[]) map[r.en] = r.text;
  if (locale === "ar") Object.assign(map, composedNames(db, map)); // fighters with no whole Arabic name, written from reviewed words (lib/i18n/name-words.ts)
  (cache.__names ??= {})[locale] = { key, map };
  return map;
}

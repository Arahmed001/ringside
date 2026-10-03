import type { Locale } from "./config";
import { makeT, type Dict, type T } from "./t";
import { getNames } from "./names";
import ar from "../../i18n/ar.json";
import clientKeys from "../../i18n/client-keys.json";

// Everything that does not need the request's [locale] segment, so route handlers, scripts and tests can use it too.
const DICTS: Record<Locale, Dict> = { en: {}, ar: ar as Dict };

export const dictOf = (locale: Locale): Dict => DICTS[locale];
export const tFor = (locale: Locale): T => makeT(locale, DICTS[locale]);

/** Translator for a locale you already have (route handlers, generateMetadata, scripts), with the proper-name table loaded (`t.name`). */
export async function getTFor(locale: Locale): Promise<T> {
  return makeT(locale, DICTS[locale], await getNames(locale));
}

/** Only the entries client components use, so the browser never downloads the whole dictionary. */
export function clientDict(locale: Locale): Dict {
  const full = DICTS[locale];
  const out: Dict = {};
  for (const k of clientKeys as string[]) if (k in full) out[k] = full[k];
  return out;
}

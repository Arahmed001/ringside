import { locale as rootLocale } from "next/root-params";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "./config";
import { getTFor } from "./dicts";
import type { T } from "./t";

export { dictOf, tFor, getTFor, clientDict } from "./dicts";

/** The locale of the page being rendered (the `[locale]` segment above the root layout). Server components only. */
export async function getLocale(): Promise<Locale> {
  const l = await rootLocale();
  if (!isLocale(l)) notFound();
  return l;
}

/** Translator for the page being rendered, with the proper-name table loaded (`t.name`). */
export async function getT(): Promise<T> {
  return getTFor(await getLocale());
}

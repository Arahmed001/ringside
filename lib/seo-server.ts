import type { Metadata } from "next";
import { isLocale, type Locale } from "./i18n/config";
import { getTFor } from "./i18n/dicts";
import type { T } from "./i18n/t";
import { pageMetadata, type PageMeta } from "./seo";
import { notFound } from "next/navigation";

/**
 * generateMetadata for a page in one line:
 *
 *   export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
 *     metaFor(params, (p, t) => ({ path: "/orgs", title: t("Gyms, promotions & bodies"), description: t("…") }));
 */
export type SearchParams = Record<string, string | string[] | undefined>;

export async function metaFor<P extends { locale: string }>(
  params: Promise<P>,
  make: (p: P, t: T, sp: SearchParams) => Omit<PageMeta, "locale"> | Promise<Omit<PageMeta, "locale">>,
  /** Pass the page's searchParams when the title depends on them (a page number, a year, a tab). */
  searchParams?: Promise<SearchParams>,
): Promise<Metadata> {
  const p = await params;
  if (!isLocale(p.locale)) notFound();
  const t = await getTFor(p.locale as Locale);
  return pageMetadata({ locale: p.locale as Locale, ...(await make(p, t, searchParams ? await searchParams : {})) });
}

/** "Fighters · Page 2": the second and later pages of a list say so in the tab title, so two tabs of one list can be told apart. */
export function pagedTitle(t: T, title: string, page: string | string[] | undefined): string {
  const n = Number(Array.isArray(page) ? page[0] : page);
  return Number.isInteger(n) && n >= 2 ? `${title} · ${t("Page {n}", { n })}` : title;
}

/** "Corners & officials · Judges": a list with tabs says which tab is open (a tab not in the list, or none, leaves the title alone). */
export function tabbedTitle(t: T, title: string, tabs: readonly (readonly [string, string])[], tab: string | string[] | undefined): string {
  const hit = tabs.find(([k]) => k === (Array.isArray(tab) ? tab[0] : tab));
  return hit ? `${title} · ${t(hit[1])}` : title;
}

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
export async function metaFor<P extends { locale: string }>(
  params: Promise<P>,
  make: (p: P, t: T) => Omit<PageMeta, "locale"> | Promise<Omit<PageMeta, "locale">>,
): Promise<Metadata> {
  const p = await params;
  if (!isLocale(p.locale)) notFound();
  const t = await getTFor(p.locale as Locale);
  return pageMetadata({ locale: p.locale as Locale, ...(await make(p, t)) });
}

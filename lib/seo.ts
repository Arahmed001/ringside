import type { Metadata } from "next";
import { LOCALES, localePath, type Locale } from "./i18n/config";

/** Public origin used in canonical URLs, hreflang, sitemaps and share images. Set SITE_URL in production. */
export const siteUrl = () => (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
export const abs = (path: string) => `${siteUrl()}${path}`;

/**
 * The demo league is fictional. Indexing it would put invented fighters in search results under real-sounding
 * names, so every page, the sitemap and robots.txt switch themselves off unless a real provider is configured
 * (or INDEXABLE=1 is set on purpose).
 */
/** True while the site runs on the fictional demo league (no real provider configured). Drives the "fictional data" footer, the Data page note and indexing. */
export const isDemoData = () => (process.env.BOXING_PROVIDER ?? "demo") === "demo";
export const indexable = () => process.env.INDEXABLE === "1" || !isDemoData();

const OG_LOCALE: Record<Locale, string> = { en: "en_US", ar: "ar_AR" };

export interface PageMeta {
  locale: Locale;
  /** Locale-free path, e.g. "/boxers/jose-ramirez". */
  path: string;
  title: string;
  description: string;
  type?: "website" | "profile" | "article";
  /** Keep this one page out of search results even on a live site. */
  noindex?: boolean;
}

/** Title, description, canonical, hreflang alternates, Open Graph and Twitter card for one page. */
export function pageMetadata({ locale, path, title, description, type = "website", noindex }: PageMeta): Metadata {
  const languages: Record<string, string> = Object.fromEntries(LOCALES.map((l) => [l, abs(localePath(l, path))]));
  languages["x-default"] = abs(localePath("en", path));
  const url = abs(localePath(locale, path));
  return {
    title,
    description,
    alternates: { canonical: url, languages },
    openGraph: {
      title, description, url, type, siteName: "Ringside", locale: OG_LOCALE[locale],
      alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
    },
    twitter: { card: "summary_large_image", title, description },
    robots: indexable() && !noindex ? { index: true, follow: true } : { index: false, follow: false },
  };
}

/** JSON-LD for a <script type="application/ld+json">; `<` is escaped so page data can never close the tag. */
export const jsonLd = (data: Record<string, unknown>) => JSON.stringify({ "@context": "https://schema.org", ...data }).replace(/</g, "\\u003c");

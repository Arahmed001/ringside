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
/** True when SITE_URL is a real public web address: an http(s) origin that is not this machine. Without it every canonical, hreflang and share URL would point at localhost. */
export function siteUrlIsPublic(raw: string | undefined = process.env.SITE_URL): boolean {
  if (!raw?.trim()) return false;
  try {
    const u = new URL(raw.trim());
    return /^https?:$/.test(u.protocol) && !/^(localhost|127\.|0\.0\.0\.0|\[::1?\])/.test(u.hostname) && !u.hostname.endsWith(".localhost");
  } catch { return false; }
}
/** Indexable only with real data (or INDEXABLE=1 on purpose) AND a public SITE_URL: a site that cannot name itself must not ask to be listed. */
export const indexable = () => (process.env.INDEXABLE === "1" || !isDemoData()) && siteUrlIsPublic();

/** Search results show about 160 characters. A longer description is cut wherever the engine likes; cut it here instead, at the end of a sentence when one fits, else at a word. */
export const DESCRIPTION_MAX = 160;
export function clampDescription(text: string, max = DESCRIPTION_MAX): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("؟ "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence >= max * 0.5) return head.slice(0, sentence + 1);
  const space = head.lastIndexOf(" ", max - 1);
  return `${head.slice(0, space > max * 0.5 ? space : max - 1).replace(/[\s,;:·.،-]+$/, "")}…`;
}

/**
 * Pages whose own `opengraph-image` file gives them a share card (Next adds it only when the page sets no openGraph of its own, and ours always do).
 * Every other page falls back to the site card, so a link shared on a messaging app or social network always has a picture. A test keeps this
 * in step with the files on disk.
 */
export const OWN_IMAGE_PATH = /^\/(?:(?:boxers|bouts|events|previews|countries|rankings|titles)\/[^/]+)?$/;

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
  /** Locale-free-or-absolute path of the share image, when it is not the one the page's own `opengraph-image` file gives. */
  image?: string;
}

/** Title, description, canonical, hreflang alternates, Open Graph and Twitter card for one page. */
export function pageMetadata({ locale, path, title, description: rawDescription, type = "website", noindex, image: given }: PageMeta): Metadata {
  const description = clampDescription(rawDescription);
  const image = given ?? (OWN_IMAGE_PATH.test(path) ? undefined : localePath(locale, "/opengraph-image"));
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
      ...(image ? { images: [{ url: abs(image), width: 1200, height: 630, alt: "Ringside" }] } : {}),
    },
    twitter: { card: "summary_large_image", title, description, ...(image ? { images: [abs(image)] } : {}) },
    robots: indexable() && !noindex ? { index: true, follow: true } : { index: false, follow: false },
  };
}

/** JSON-LD for a <script type="application/ld+json">; `<` is escaped so page data can never close the tag. */
export const jsonLd = (data: Record<string, unknown>) => JSON.stringify({ "@context": "https://schema.org", ...data }).replace(/</g, "\\u003c");

/** BreadcrumbList for a page: the trail from the home page down, each item with its own address (the last is the page itself). Names are the page names a visitor sees. */
export function breadcrumbLd(locale: Locale, trail: readonly { name: string; path: string }[]): Record<string, unknown> {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: abs(localePath(locale, c.path)) })),
  };
}

/** `?q=` on any page is somebody's search: an endless set of thin pages that must never be listed (the proxy marks them noindex, follow). */
export const hasSearchQuery = (sp: URLSearchParams) => (sp.get("q") ?? "").trim() !== "";

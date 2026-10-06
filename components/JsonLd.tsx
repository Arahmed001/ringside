import { breadcrumbLd, indexable, jsonLd } from "@/lib/seo";
import type { Locale } from "@/lib/i18n/config";

/** Structured data for search engines. Rendered only on an indexable deployment (never for the fictional demo league). */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  if (!indexable()) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}

/** The trail a page sits under (home, then its section, then the page), as a BreadcrumbList. `trail` is section first, page last. */
export function BreadcrumbLd({ locale, trail }: { locale: Locale; trail: readonly { name: string; path: string }[] }) {
  return <JsonLd data={breadcrumbLd(locale, [{ name: "Ringside", path: "/" }, ...trail])} />;
}

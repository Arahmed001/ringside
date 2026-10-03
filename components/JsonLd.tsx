import { indexable, jsonLd } from "@/lib/seo";

/** Structured data for search engines. Rendered only on an indexable deployment (never for the fictional demo league). */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  if (!indexable()) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}

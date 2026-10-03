import { getWorld } from "@/lib/world";
import { sitemapIndexXml } from "@/lib/sitemap";
import { indexable } from "@/lib/seo";

export const dynamic = "force-dynamic";

/** The sitemap index; the demo league is fictional, so it publishes none (see lib/seo.ts). */
export async function GET() {
  if (!indexable()) return new Response("Not found", { status: 404, headers: { "x-robots-tag": "noindex" } });
  return new Response(sitemapIndexXml(await getWorld()), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

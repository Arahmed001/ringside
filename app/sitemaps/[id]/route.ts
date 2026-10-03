import { getWorld } from "@/lib/world";
import { sitemapXml } from "@/lib/sitemap";
import { indexable } from "@/lib/seo";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const index = Number.parseInt((await ctx.params).id, 10); // "3.xml" -> 3
  const xml = indexable() && Number.isInteger(index) && index >= 0 ? sitemapXml(await getWorld(), index) : null;
  if (!xml) return new Response("Not found", { status: 404, headers: { "x-robots-tag": "noindex" } });
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

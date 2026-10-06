import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { getWorld } from "@/lib/world";
import { sitemapGzip } from "@/lib/sitemap";
import { indexable } from "@/lib/seo";

const gunzipAsync = promisify(gunzip); // on the thread pool: unpacking 8 MB on the main thread would hold every other visitor

/** What a sitemap file is the same for every visitor, so a shared cache may keep it (an hour), and a different encoding of it is a different copy (Vary). */
const HEADERS = { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600", vary: "Accept-Encoding" };

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const index = Number.parseInt((await ctx.params).id, 10); // "3.xml" -> 3
  const gz = indexable() && Number.isInteger(index) && index >= 0 ? await sitemapGzip(await getWorld(), index) : null;
  if (!gz) return new Response("Not found", { status: 404, headers: { "x-robots-tag": "noindex" } });
  // every crawler asks for gzip; anything that does not gets the plain XML, unpacked from the same bytes
  const wantsGzip = /\bgzip\b/i.test(req.headers.get("accept-encoding") ?? "");
  if (wantsGzip) return new Response(new Uint8Array(gz), { headers: { ...HEADERS, "content-encoding": "gzip" } });
  return new Response(new Uint8Array(await gunzipAsync(gz)), { headers: HEADERS });
}

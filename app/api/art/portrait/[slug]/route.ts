import { getWorld } from "@/lib/world";
import { etagOf, portraitSvg } from "@/lib/art";

/**
 * GET /api/art/portrait/<slug>.svg: the generated portrait for a fighter (the one shown when there is no licensed photo).
 * It is deterministic, so browsers and CDNs may keep it; pages reference it with <img> rather than inlining the SVG.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await ctx.params;
  const b = (await getWorld()).bySlug.get(raw.replace(/\.svg$/, ""));
  if (!b) return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const body = portraitSvg(b);
  const etag = etagOf(body);
  const headers = {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}

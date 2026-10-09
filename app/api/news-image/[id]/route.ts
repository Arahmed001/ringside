import { readNewsImage } from "@/lib/news/images";

/** A saved picture of a news headline, from this server's own folder (lib/news/images.ts). It reads only what `news:refresh` already saved and never fetches anything. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const raw = (await ctx.params).id;
  const img = /^\d{1,9}$/.test(raw) ? readNewsImage(Number(raw)) : null;
  if (!img) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(img.bytes), { status: 200, headers: { "content-type": img.type, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" } });
}

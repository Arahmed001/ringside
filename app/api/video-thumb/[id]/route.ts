import { readThumb } from "@/lib/news/thumbs";

/** A saved thumbnail of an official video, from this server's own folder (lib/news/thumbs.ts). It reads only what `news:refresh` already saved and never fetches anything. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id;
  const bytes = readThumb(id);
  if (!bytes) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" } });
}

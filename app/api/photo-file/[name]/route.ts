import fs from "node:fs";
import path from "node:path";
import { userOf } from "@/lib/accounts/api";
import { canServe, photoDir } from "@/lib/photos/submissions";

/** A picture sent in through the site. Served only when it is on a fighter's page, or to its sender and the editors while it waits; the name is checked against one exact shape. */
export async function GET(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
  if (!canServe(name, userOf(req))) return notFound();
  let bytes: Buffer;
  try { bytes = fs.readFileSync(path.join(photoDir(), name)); } catch { return notFound(); }
  const shown = canServe(name, null); // on a fighter's page: cacheable by anyone; a waiting picture is private
  return new Response(new Uint8Array(bytes), { headers: {
    "content-type": name.endsWith(".png") ? "image/png" : "image/jpeg", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox",
    "cache-control": shown ? "public, max-age=86400" : "private, no-store", "content-length": String(bytes.length),
  } });
}

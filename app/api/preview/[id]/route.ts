import { NextResponse } from "next/server";
import { getWorld } from "@/lib/world";
import { previewArticle } from "@/lib/preview";
import { isLocale, DEFAULT_LOCALE } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";

/** The preview article for an upcoming bout: GET /api/preview/123?lang=ar → { paragraphs, source: "ai" | "rules" }. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const lang = new URL(req.url).searchParams.get("lang");
  const w = await getWorld();
  const b = w.boutById.get(Number(id));
  if (!b || !b.upcoming) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(await previewArticle(w, b, await getTFor(isLocale(lang) ? lang : DEFAULT_LOCALE)));
}

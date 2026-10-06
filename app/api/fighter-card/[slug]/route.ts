import { NextResponse } from "next/server";
import { getWorld } from "@/lib/world";
import { fighterCard } from "@/lib/fighter-card";
import { isLocale, DEFAULT_LOCALE } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";

/** The few lines the hover preview of a fighter shows: GET /api/fighter-card/some-name?lang=ar. Read-only, built from the world already in memory, and cacheable for five minutes. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lang = new URL(req.url).searchParams.get("lang");
  const w = await getWorld();
  const b = w.bySlug.get(slug);
  if (!b) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(fighterCard(w, b, await getTFor(isLocale(lang) ? lang : DEFAULT_LOCALE)), { headers: { "Cache-Control": "public, max-age=300" } });
}

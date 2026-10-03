import { NextResponse } from "next/server";
import { getWorld } from "@/lib/world";
import { scoutingReport } from "@/lib/ai";
import { isLocale, DEFAULT_LOCALE } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lang = new URL(req.url).searchParams.get("lang");
  const w = await getWorld();
  const b = w.bySlug.get(slug);
  if (!b) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(await scoutingReport(b, w, await getTFor(isLocale(lang) ? lang : DEFAULT_LOCALE)));
}

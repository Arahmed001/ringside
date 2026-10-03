import { NextResponse } from "next/server";
import { getWorld } from "@/lib/world";
import { watchEntries, MAX_WATCH } from "@/lib/watch";
import { isLocale, DEFAULT_LOCALE } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";

/** The watchlist strip's data for the slugs one visitor starred: GET /api/watch?slugs=a,b,c&lang=ar */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const slugs = (sp.get("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_WATCH);
  const lang = sp.get("lang");
  const t = await getTFor(isLocale(lang) ? lang : DEFAULT_LOCALE);
  return NextResponse.json(slugs.length ? watchEntries(await getWorld(), slugs, t) : []);
}

import { NextResponse } from "next/server";
import { getWorld } from "@/lib/world";
import { searchFighters, toHit } from "@/lib/fighter-search";
import { isLocale, DEFAULT_LOCALE } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";
import { getNames } from "@/lib/i18n/names";

/** Type-ahead for fighter pickers: GET /api/fighters?q=ram&min=5&lang=ar → up to 8 matches, names and divisions in that language. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").slice(0, 80);
  const min = Math.min(50, Math.max(0, Number(sp.get("min")) || 0));
  const lang = sp.get("lang");
  if (q.trim().length < 2) return NextResponse.json([]);
  const t = await getTFor(isLocale(lang) ? lang : DEFAULT_LOCALE);
  const names = await getNames(t.locale);
  return NextResponse.json(searchFighters(await getWorld(), q, { limit: 8, minBouts: min, names }).map((b) => toHit(b, t)));
}

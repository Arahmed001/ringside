import { NextResponse } from "next/server";
import { getWorld } from "@/lib/world";
import { MAX_WATCH } from "@/lib/watch";
import { isRealDay, watchDigest } from "@/lib/watch-digest";
import { isLocale, DEFAULT_LOCALE } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";

/**
 * What changed for the fighters one visitor follows since a day: GET /api/watch/digest?slugs=a,b&since=2026-09-30&lang=ar
 * Without `since` (a first visit) it answers with the data's own day and no items, so the page can remember "seen up to here". Nothing is stored about the visitor.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const slugs = (sp.get("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_WATCH);
  const since = sp.get("since");
  if (since !== null && !isRealDay(since)) return NextResponse.json({ error: "since must be a real day, YYYY-MM-DD" }, { status: 400 });
  const lang = sp.get("lang");
  const t = await getTFor(isLocale(lang) ? lang : DEFAULT_LOCALE);
  const w = await getWorld();
  const headers = { "Cache-Control": "no-store" };
  return NextResponse.json(since === null ? { today: w.today, since: null, clamped: false, watched: slugs.length, items: [] } : watchDigest(w, slugs, since, t), { headers });
}

import { NextResponse } from "next/server";
import { getWorld } from "@/lib/world";
import { getDb } from "@/lib/db";
import { pickInfos } from "@/lib/picks";
import { MAX_PICKS } from "@/lib/picks-grade";
import { isLocale, DEFAULT_LOCALE } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";

/** The facts behind one visitor's picks: GET /api/picks?ids=12,15&lang=ar. The picks themselves stay in the browser. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const ids = (sp.get("ids") ?? "").split(",").map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0).slice(0, MAX_PICKS);
  const lang = sp.get("lang");
  if (!ids.length) return NextResponse.json([]);
  const t = await getTFor(isLocale(lang) ? lang : DEFAULT_LOCALE);
  return NextResponse.json(pickInfos(await getDb(), await getWorld(), ids, t));
}

import { NextResponse } from "next/server";
import { getWorld } from "@/lib/world";
import { globalSearch } from "@/lib/search";
import { isLocale, DEFAULT_LOCALE } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";
import { getNames } from "@/lib/i18n/names";

/** ⌘K: GET /api/search?q=…&lang=ar → fighters, corners, events, organisations and pages that match, grouped by `kind`. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").slice(0, 80);
  const lang = sp.get("lang");
  const t = await getTFor(isLocale(lang) ? lang : DEFAULT_LOCALE);
  return NextResponse.json(globalSearch(await getWorld(), q, t, await getNames(t.locale)));
}

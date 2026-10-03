import { NextResponse } from "next/server";
import { getWorld } from "@/lib/world";
import { askData, MAX_QUESTION } from "@/lib/ask";
import { isLocale, DEFAULT_LOCALE } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";
import { getNames } from "@/lib/i18n/names";
import { clientId } from "@/lib/ai-guard";

/** GET /api/ask?q=…&lang=ar → { answer, source, planner, understood, limited?, hint?, calls, tables } (see lib/ask/index.ts for how it is answered). */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").slice(0, MAX_QUESTION).trim();
  if (!q) return NextResponse.json({ error: "q is required" }, { status: 400 });
  const lang = sp.get("lang");
  const t = await getTFor(isLocale(lang) ? lang : DEFAULT_LOCALE);
  const a = await askData(q, { w: await getWorld(), t, names: await getNames(t.locale) }, clientId(req.headers));
  return NextResponse.json({ answer: a.answer, source: a.source, planner: a.planner, understood: a.understood, ...(a.limited ? { limited: a.limited } : {}), ...(a.hint ? { hint: a.hint } : {}), calls: a.calls, tables: a.results.flatMap((r) => r.tables) });
}

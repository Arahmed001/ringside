import { isLocale } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";
import { ogCard } from "@/lib/og";
import { getWorld, recordStr } from "@/lib/world";
import { predict } from "@/lib/predict";

/**
 * The share card of one matchup: `/api/og/compare?a=<slug>&b=<slug>&lang=en`. A card file cannot read query parameters, so the matchup page points its Open Graph
 * image here. Only two fighters that exist are drawn; anything else is the plain 404 it is, so the route cannot be used to put words on a Ringside card.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const slug = /^[a-z0-9-]{1,100}$/;
  const sa = q.get("a") ?? "", sb = q.get("b") ?? "";
  const lang = q.get("lang") ?? "en";
  if (!slug.test(sa) || !slug.test(sb) || !isLocale(lang)) return new Response("Not found", { status: 404 });
  const w = await getWorld();
  const A = w.bySlug.get(sa), B = w.bySlug.get(sb);
  if (!A || !B || A.id === B.id) return new Response("Not found", { status: 404 });
  const t = await getTFor(lang);
  const p = predict(A, B, t);
  const res = await ogCard({
    locale: lang, t, accent: "red",
    kicker: t("Head to head"),
    title: t("{a} vs {b}", { a: t.name(A.name), b: t.name(B.name) }),
    subtitle: t("Model win probability: {a}% to {b}%", { a: Math.round(p.pA * 100), b: Math.round(p.pB * 100) }),
    stats: [{ label: t.name(A.name), value: recordStr(A) }, { label: t.name(B.name), value: recordStr(B) }],
  });
  res.headers.set("Cache-Control", "public, max-age=3600");
  return res;
}

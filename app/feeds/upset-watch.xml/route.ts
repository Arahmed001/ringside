import { getWorld } from "@/lib/world";
import { tierOf, upsetWatch, TIER_LABEL } from "@/lib/upsets";
import { tFor } from "@/lib/i18n/dicts";
import { isLocale, localePath, type Locale } from "@/lib/i18n/config";
import { abs } from "@/lib/seo";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * An Atom feed of the upcoming fights where the underdog is live (28% or better), for any feed reader: the alert for
 * people who do not want to check the page. One entry per fight, stable id, so a reader shows each only once.
 * `?lang=ar` for Arabic.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("lang");
  const locale: Locale = q && isLocale(q) ? q : "en";
  const t = tFor(locale);
  const w = await getWorld();
  const entries = upsetWatch(w, t).filter((x) => tierOf(x.chance) !== "longshot");
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${locale}">
  <id>tag:ringside,2026:upset-watch:${locale}</id>
  <title>${esc(t("Upset watch"))} · Ringside</title>
  <subtitle>${esc(t("Upcoming fights where the underdog has a real chance"))}</subtitle>
  <link rel="self" type="application/atom+xml" href="${esc(abs(`/feeds/upset-watch.xml${locale === "ar" ? "?lang=ar" : ""}`))}"/>
  <link rel="alternate" type="text/html" href="${esc(abs(localePath(locale, "/upset-watch")))}"/>
  <updated>${w.today}T00:00:00Z</updated>
${entries.map((x) => `  <entry>
    <id>tag:ringside,2026:upset-watch:${locale}:${x.bout.id}</id>
    <title>${esc(t("{name} has a {pct}% chance against {other}", { name: t.name(x.underdog.name), pct: Math.round(x.chance * 100), other: t.name(x.favourite.name) }))}</title>
    <link rel="alternate" type="text/html" href="${esc(abs(localePath(locale, `/previews/${x.bout.id}`)))}"/>
    <updated>${w.today}T00:00:00Z</updated>
    <category term="${esc(t(TIER_LABEL[x.tier]))}"/>
    <summary>${esc([`${t.name(x.event.name)} · ${x.event.date}`, ...x.signals.map((s) => s.text)].join(" · "))}</summary>
  </entry>`).join("\n")}
</feed>
`;
  return new Response(xml, { headers: { "content-type": "application/atom+xml; charset=utf-8", "cache-control": "public, max-age=900" } });
}

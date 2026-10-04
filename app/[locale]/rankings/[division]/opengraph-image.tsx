import { isLocale } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";
import { OG_SIZE, OG_TYPE, ogCard } from "@/lib/og";
import { getWorld, recordStr } from "@/lib/world";
import { divisionFromSlug } from "@/lib/divisions";
import { rankDivision } from "@/lib/rankings";

export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "Division rankings";

/** The share card of a division's ranking (the men's, which is the page's default): the division, the top-rated fighter and their numbers. */
export default async function Image({ params }: { params: Promise<{ locale: string; division: string }> }) {
  const { locale, division } = await params;
  const l = isLocale(locale) ? locale : "en";
  const t = await getTFor(l);
  const d = divisionFromSlug(division);
  if (!d) return ogCard({ locale: l, t, title: t("Rankings") });
  const top = rankDivision(await getWorld(), d.name, 1, "male")[0];
  return ogCard({
    locale: l, t, accent: "gold",
    kicker: t("Rankings"),
    title: t("{division} rankings", { division: t(d.name) }),
    subtitle: top ? t.name(top.boxer.name) : undefined,
    stats: top ? [{ label: t("record"), value: recordStr(top.boxer) }, { label: t("Elo rating"), value: String(Math.round(top.boxer.rating)) }] : [],
  });
}

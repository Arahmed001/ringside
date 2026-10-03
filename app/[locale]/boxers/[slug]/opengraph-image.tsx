import { isLocale } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";
import { OG_SIZE, OG_TYPE, ogCard } from "@/lib/og";
import { getWorld, recordStr } from "@/lib/world";
import { countryName, pct } from "@/lib/format";
import { divisionLabel } from "@/lib/divisions";

export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "Fighter profile";

export default async function Image({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const l = isLocale(locale) ? locale : "en";
  const t = await getTFor(l);
  const b = (await getWorld()).bySlug.get(slug);
  if (!b) return ogCard({ locale: l, t, title: t("Fighter not found") });
  return ogCard({
    locale: l, t, accent: "red",
    kicker: `${divisionLabel(b.weightClass, b.sex, t)} · ${countryName(b.country, l)}`,
    title: t.name(b.name),
    subtitle: b.nickname ? `“${t.name(b.nickname)}”` : undefined,
    stats: [
      { label: t("record"), value: recordStr(b) },
      { label: t("Elo rating"), value: String(Math.round(b.rating)) },
      { label: t("KO rate"), value: pct(b.koRate) },
    ],
  });
}

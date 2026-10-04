import { isLocale } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";
import { OG_SIZE, OG_TYPE, ogCard } from "@/lib/og";
import { getWorld } from "@/lib/world";
import { countryView } from "@/lib/countries";
import { countryName } from "@/lib/format";

export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "Boxing by country";

/** The share card of a country: its name, its best-rated fighter, and how many fighters, how many active and how many champions it has. */
export default async function Image({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const l = isLocale(locale) ? locale : "en";
  const t = await getTFor(l);
  const v = countryView(await getWorld(), slug, { top: 1, next: 0, events: 0 });
  if (!v) return ogCard({ locale: l, t, title: t("Boxing by country") });
  return ogCard({
    locale: l, t, accent: "gold",
    kicker: t("Boxing by country"),
    title: countryName(v.name, l),
    subtitle: v.top[0] ? t.name(v.top[0].name) : undefined,
    stats: [{ label: t("Fighters"), value: String(v.fighters) }, { label: t("Active"), value: String(v.active) }, { label: t("Champions"), value: String(v.champions.length) }],
  });
}

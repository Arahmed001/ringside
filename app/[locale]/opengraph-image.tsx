import { isLocale } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";
import { OG_SIZE, OG_TYPE, ogCard } from "@/lib/og";
import { getWorld } from "@/lib/world";

export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "Ringside";

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const l = isLocale(locale) ? locale : "en";
  const t = await getTFor(l);
  const w = await getWorld();
  return ogCard({
    locale: l, t, accent: "red",
    kicker: t("Boxing intelligence"),
    title: t("Every fighter. Every number."),
    stats: [
      { label: t("fighters"), value: w.boxers.length.toLocaleString("en-US") },
      { label: t("bouts"), value: w.bouts.filter((b) => !b.upcoming).length.toLocaleString("en-US") },
      { label: t("events"), value: w.events.filter((e) => !e.upcoming).length.toLocaleString("en-US") },
    ],
  });
}

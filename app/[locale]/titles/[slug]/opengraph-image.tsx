import { isLocale } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";
import { OG_SIZE, OG_TYPE, ogCard } from "@/lib/og";
import { getWorld } from "@/lib/world";
import { beltBySlug, beltLabel, beltStats } from "@/lib/lineage";
import { divisionLabel } from "@/lib/divisions";

export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "Title lineage";

/** The share card of one belt: which belt, its division, who holds it now (unless it is dormant) and how long its line of champions is. */
export default async function Image({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const l = isLocale(locale) ? locale : "en";
  const t = await getTFor(l);
  const w = await getWorld();
  const b = beltBySlug(w, slug);
  if (!b) return ogCard({ locale: l, t, title: t("Title lineage") });
  const champ = b.current && !b.stale ? w.byId.get(b.current.boxerId) : undefined;
  const s = beltStats(w, b);
  return ogCard({
    locale: l, t, accent: "gold",
    kicker: divisionLabel(b.division, b.sex, t),
    title: beltLabel(b, t),
    subtitle: champ ? t.name(champ.name) : undefined,
    stats: [{ label: t("Reigns"), value: String(b.reigns.length) }, { label: t("Title defences"), value: String(s.totalDefenses) }],
  });
}

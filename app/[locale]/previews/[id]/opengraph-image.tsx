import { isLocale } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";
import { OG_SIZE, OG_TYPE, ogCard } from "@/lib/og";
import { getWorld } from "@/lib/world";
import { buildPreview } from "@/lib/preview";
import { fmtDate } from "@/lib/format";

export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "Fight preview";

export default async function Image({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const l = isLocale(locale) ? locale : "en";
  const t = await getTFor(l);
  const w = await getWorld();
  const b = w.boutById.get(Number(id));
  if (!b || !b.upcoming) return ogCard({ locale: l, t, title: t("Fight preview") });
  const pv = buildPreview(w, b, t);
  return ogCard({
    locale: l, t, accent: pv.pick.favourite.id === pv.red.id ? "red" : "blue",
    kicker: `${t("Fight preview")} · ${fmtDate(pv.event.date, { month: "short", day: "numeric", year: "numeric" }, l)}`,
    title: t("{a} vs {b}", { a: t.name(pv.red.name), b: t.name(pv.blue.name) }),
    subtitle: t("The model favours {name} at {pct}%", { name: t.name(pv.pick.favourite.name), pct: pv.pick.pct }),
    stats: [{ label: t("fight score"), value: String(pv.score) }, { label: t("stoppage chance"), value: `${Math.round(pv.pick.koProb * 100)}%` }],
  });
}

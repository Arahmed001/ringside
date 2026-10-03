import { isLocale } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";
import { OG_SIZE, OG_TYPE, ogCard } from "@/lib/og";
import { getWorld } from "@/lib/world";
import { fmtDate, methodLabel } from "@/lib/format";
import { divisionLabel } from "@/lib/divisions";

export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "Bout result";

export default async function Image({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const l = isLocale(locale) ? locale : "en";
  const t = await getTFor(l);
  const w = await getWorld();
  const b = w.boutById.get(Number(id));
  if (!b) return ogCard({ locale: l, t, title: t("Bout not found") });
  const red = w.byId.get(b.redId)!;
  const winner = b.winnerId ? w.byId.get(b.winnerId) : null;
  return ogCard({
    locale: l, t, accent: winner ? (winner.id === b.redId ? "red" : "blue") : "gold",
    kicker: `${t.name(b.eventName)} · ${fmtDate(b.date, { month: "short", day: "numeric", year: "numeric" }, l)}`,
    title: t("{a} vs {b}", { a: t.name(b.redName), b: t.name(b.blueName) }),
    subtitle: b.upcoming ? t("Upcoming · {rounds} rounds", { rounds: b.rounds }) : winner ? t("{name} wins · {result}", { name: t.name(winner.name), result: methodLabel(b.method, b.endRound, t) }) : methodLabel(b.method, b.endRound, t),
    stats: [{ label: t("division"), value: divisionLabel(b.weightClass, red.sex, t) }],
  });
}

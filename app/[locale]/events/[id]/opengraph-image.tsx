import { isLocale } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";
import { OG_SIZE, OG_TYPE, ogCard } from "@/lib/og";
import { getWorld, recordStr } from "@/lib/world";
import { eventWithMain } from "@/lib/events";
import { fmtDate } from "@/lib/format";

export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "Fight card";

export default async function Image({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const l = isLocale(locale) ? locale : "en";
  const t = await getTFor(l);
  const w = await getWorld();
  const e = w.eventById.get(Number(id));
  const v = e ? eventWithMain(w, e) : null;
  if (!e || !v) return ogCard({ locale: l, t, title: t("Event not found") });
  return ogCard({
    locale: l, t, accent: "gold",
    kicker: `${fmtDate(e.date, { month: "long", day: "numeric", year: "numeric" }, l)} · ${t.name(e.city)}`,
    title: t("{a} vs {b}", { a: t.name(v.red.name), b: t.name(v.blue.name) }),
    subtitle: t.name(e.name),
    stats: [
      { label: t.name(v.red.name), value: recordStr(v.red) },
      { label: t.name(v.blue.name), value: recordStr(v.blue) },
      { label: t("bouts on the card"), value: String(v.bouts.length) },
    ],
  });
}

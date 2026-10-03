import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { fmtDate } from "@/lib/format";
import { divisionLabel } from "@/lib/divisions";
import { beltLabel, reignsOf } from "@/lib/lineage";
import { suggestOpponents } from "@/lib/matchmaking";
import type { World } from "@/lib/world";
import type { BoxerFull } from "@/lib/types";
import { Headshot } from "@/components/Portrait";

/** The belts a fighter has held: dates, defences, and whether they are champion now. */
export async function TitlesCard({ w, boxer }: { w: World; boxer: BoxerFull }) {
  const t = await getT();
  const held = reignsOf(w, boxer.id);
  if (!held.length) return null;
  const live = held.filter((h) => h.reign.end === null && !h.belt.stale).length;
  return (
    <section className="card p-5" aria-labelledby={`titles-${boxer.id}`}>
      <div className="eyebrow mb-1" id={`titles-${boxer.id}`}>{t("Titles")}</div>
      <div className="font-display text-2xl font-bold">{live ? t.n(live, "Current champion: {n} belt", "Current champion: {n} belts") : t.n(held.length, "{n} reign on record", "{n} reigns on record")}</div>
      <ul className="mt-3 divide-y divide-line/60 text-sm">
        {held.map(({ belt, reign }) => (
          <li key={`${belt.slug}-${reign.n}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <Link href={`/titles/${belt.slug}`} className="min-w-0 hover:text-gold"><b>{beltLabel(belt, t)}</b> <span className="text-muted">· {divisionLabel(belt.division, belt.sex, t)}</span></Link>
            <span className="text-xs text-muted tabular">
              {fmtDate(reign.start, { month: "short", year: "numeric" }, t.locale)} – {reign.end ? fmtDate(reign.end, { month: "short", year: "numeric" }, t.locale) : t("present")} · {t.n(reign.defenses.length, "{n} defence", "{n} defences")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Three opponents worth making for an active fighter who has no fight booked, linking to the full matchmaking view. */
export async function NextFightCard({ w, boxer }: { w: World; boxer: BoxerFull }) {
  const t = await getT();
  if (!boxer.active || (w.boutsByBoxer.get(boxer.id) ?? []).some((b) => b.upcoming)) return null;
  const top = suggestOpponents(w, boxer, 3, t);
  if (!top.length) return null;
  return (
    <section className="card p-5" aria-labelledby={`next-${boxer.id}`}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div><div className="eyebrow mb-1" id={`next-${boxer.id}`}>{t("Matchmaking")}</div><div className="font-display text-2xl font-bold">{boxer.sex === "female" ? t("Who should she fight next?") : t("Who should he fight next?")}</div></div>
        <Link href={`/matchmaking?a=${boxer.slug}#next`} className="shrink-0 text-sm text-muted hover:text-ink">{t("More opponents")} <span className="inline-block rtl:rotate-180">→</span></Link>
      </div>
      <ol className="space-y-3">
        {top.map((p, i) => (
          <li key={p.b.id} className="flex items-center gap-3 text-sm">
            <span className="w-5 text-center font-display text-lg font-bold text-gold">{i + 1}</span>
            <Headshot boxer={p.b} size={36} />
            <div className="min-w-0 flex-1">
              <Link href={`/boxers/${p.b.slug}`} className="block truncate font-semibold hover:text-gold">{t.name(p.b.name)}</Link>
              <div className="truncate text-xs text-muted">{p.reasons[0]}</div>
            </div>
            <Link href={`/compare?a=${boxer.slug}&b=${p.b.slug}`} className="shrink-0 text-end" title={t("Fight score out of 100: how close, relevant, entertaining, bookable, fresh and meaningful the fight is")}>
              <div className="font-display text-xl font-extrabold leading-none text-gold tabular">{p.score}</div>
              <div className="text-[10px] uppercase tracking-widest text-muted">{t("fight score")}</div>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

import { notFound } from "next/navigation";
import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { beltBySlug, beltLabel, beltStats, type Reign } from "@/lib/lineage";
import { divisionLabel, slugifyDivision } from "@/lib/divisions";
import { Headshot } from "@/components/Portrait";
import { ReignTimeline } from "@/components/ReignTimeline";
import { SectionTitle, Stat } from "@/components/ui";
import { fmtDate, methodLabel } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";
import { metaFor } from "@/lib/seo-server";
import { JsonLd } from "@/components/JsonLd";
import { abs } from "@/lib/seo";
import { localePath } from "@/lib/i18n/config";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string; slug: string }> }) =>
  metaFor(params, async ({ slug }, t) => {
    const w = await getWorld();
    const b = beltBySlug(w, slug);
    if (!b) return { path: `/titles/${slug}`, title: t("Title lineage"), description: t("The line of champions for one belt.") };
    const s = beltStats(w, b);
    const champ = b.current ? w.byId.get(b.current.boxerId) : undefined;
    return {
      path: `/titles/${b.slug}`, title: t("{belt}: {division} champions", { belt: beltLabel(b, t), division: divisionLabel(b.division, b.sex, t) }),
      description: t("Every {division} champion of the {belt}: {n} reigns by {champions} fighters, {defences} title defences{current}.", {
        division: divisionLabel(b.division, b.sex, t), belt: beltLabel(b, t), n: b.reigns.length, champions: s.champions, defences: s.totalDefenses,
        current: champ && !b.stale ? t(", current champion {name}", { name: t.name(champ.name) }) : "",
      }),
    };
  });

const HOW = { won: msg("Won the belt"), vacant: msg("Won the vacant belt"), first: msg("First champion on record"), inherited: msg("Took the belt when the holder was not in the fight") } as const;
const ENDED = { lost: msg("Lost it in the ring"), vacated: msg("Belt vacated"), passed: msg("Belt passed on without the champion") } as const;

export default async function BeltPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getT();
  const w = await getWorld();
  const belt = beltBySlug(w, slug);
  if (!belt) notFound();
  const s = beltStats(w, belt);
  const champ = belt.current ? w.byId.get(belt.current.boxerId) : undefined;
  const name = (id: number | null) => (id === null ? "" : t.name(w.byId.get(id)?.name ?? ""));
  const reigns = [...belt.reigns].reverse();
  const bout = (r: Reign) => w.boutById.get(r.boutId);
  const days = (n: number) => (n >= 730 ? t("{n} years", { n: (n / 365.25).toFixed(1) }) : n >= 60 ? t("{n} months", { n: Math.round(n / 30.4) }) : t.n(n, "{n} day", "{n} days"));

  return (
    <div className="space-y-10">
      <JsonLd data={{ "@type": "Dataset", name: `${beltLabel(belt, t)} · ${divisionLabel(belt.division, belt.sex, t)}`, url: abs(localePath(t.locale, `/titles/${belt.slug}`)), inLanguage: t.locale, creator: { "@type": "Organization", name: "Ringside" } }} />
      <div>
        <div className="eyebrow mb-2"><Link href="/titles" className="inline-block py-1 hover:text-ink">{t("Title lineages")}</Link> · {divisionLabel(belt.division, belt.sex, t)}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase leading-none">{beltLabel(belt, t)}</h1>
        <p className="mt-2 text-muted">{divisionLabel(belt.division, belt.sex, t)} · {t("{from} to {to}", { from: fmtDate(belt.firstDate, { month: "short", year: "numeric" }, t.locale), to: fmtDate(belt.lastDate, { month: "short", year: "numeric" }, t.locale) })} · <Link href={`/rankings/${slugifyDivision(belt.division)}${belt.sex === "female" ? "?sex=female" : ""}`} className="hover:text-ink">{t("Division rankings")}</Link></p>
      </div>

      {champ && belt.current && (
        <Link href={`/boxers/${champ.slug}`} className="card card-hover flex flex-wrap items-center gap-5 p-5">
          <Headshot boxer={champ} size={88} />
          <div className="min-w-0">
            <div className="eyebrow mb-1">{belt.stale ? t("Last champion on record (the belt looks dormant)") : t("Current champion")}</div>
            <div className="font-display text-4xl font-extrabold leading-tight">{t.name(champ.name)}</div>
            <div className="text-sm text-muted">{t("since {date}", { date: fmtDate(belt.current.start, undefined, t.locale) })} · {days(belt.current.days)} · {t.n(belt.current.defenses.length, "{n} defence", "{n} defences")}</div>
          </div>
        </Link>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("Champions")} value={s.champions} sub={t.n(belt.reigns.length, "{n} reign", "{n} reigns")} />
        <Stat label={t("Title fights")} value={belt.titleFights} sub={t("decided or drawn")} />
        <Stat label={t("Total defences")} value={s.totalDefenses} />
        <Stat label={t("Longest reign")} value={s.longest ? days(s.longest.days) : "–"} sub={s.longest ? name(s.longest.boxerId) : undefined} />
        <Stat label={t("Most defences")} value={s.mostDefenses?.defenses.length ?? 0} sub={s.mostDefenses ? name(s.mostDefenses.boxerId) : undefined} />
      </section>

      <section>
        <SectionTitle eyebrow={t("Through time")} title={t("The line of champions")} />
        <div className="card p-5"><ReignTimeline w={w} belt={belt} /><p className="mt-3 text-xs text-muted">{t("Each bar is one reign; gaps are periods when the belt was vacant. Hover for dates and defences.")}</p></div>
      </section>

      <section>
        <SectionTitle eyebrow={t("Newest first")} title={t("Every reign")} />
        <div className="space-y-3">
          {reigns.map((r) => {
            const who = w.byId.get(r.boxerId);
            const b = bout(r);
            const lostTo = r.endedBy === "lost" && r.endedByBoutId ? w.boutById.get(r.endedByBoutId) : null;
            const winnerName = lostTo?.winnerId ? name(lostTo.winnerId) : "";
            return (
              <article key={r.n} className="card min-w-0 p-4">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="w-8 font-display text-2xl font-bold text-gold tabular">{r.n}</span>
                  {who && <Headshot boxer={who} size={52} />}
                  <div className="min-w-0 flex-1">
                    <Link href={`/boxers/${who?.slug ?? ""}`} className="font-display text-2xl font-bold leading-tight hover:text-gold">{name(r.boxerId)}</Link>
                    <div className="text-xs text-muted">
                      {t(HOW[r.how])}{r.opponentId ? ` · ${t("beat {name}", { name: name(r.opponentId) })}` : ""}{b ? <> · <Link href={`/bouts/${b.id}`} className="hover:text-ink">{fmtDate(r.start, { month: "short", day: "numeric", year: "numeric" }, t.locale)}, {methodLabel(b.method, b.endRound, t)}</Link></> : null}
                    </div>
                  </div>
                  <div className="text-end text-sm">
                    <div className="tabular"><b>{days(r.days)}</b> · {t.n(r.defenses.length, "{n} defence", "{n} defences")}{r.draws ? ` · ${t.n(r.draws, "{n} draw", "{n} draws")}` : ""}</div>
                    <div className="text-xs text-muted">
                      {r.end ? `${t(ENDED[r.endedBy!])}${winnerName ? ` · ${t("to {name}", { name: winnerName })}` : ""} · ${fmtDate(r.end, { month: "short", year: "numeric" }, t.locale)}` : belt.stale ? t("reign still on the books") : t("current champion")}
                    </div>
                  </div>
                </div>
                {r.defenses.length > 0 && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer py-1.5 text-muted hover:text-ink">{t.n(r.defenses.length, "{n} defence", "{n} defences")}</summary>
                    <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                      {r.defenses.map((d) => (
                        <li key={d.boutId}><Link href={`/bouts/${d.boutId}`} className="hover:text-gold">{fmtDate(d.date, { month: "short", year: "numeric" }, t.locale)} · {t("beat {name}", { name: name(d.opponentId) })} · {methodLabel(d.method, d.endRound, t)}</Link></li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

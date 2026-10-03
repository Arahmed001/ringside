import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import * as A from "@/lib/analytics";
import { Heatmap, BarList, Donut, ColumnChart } from "@/components/charts";
import { Stat, SectionTitle } from "@/components/ui";
import { Headshot } from "@/components/Portrait";
import { fmtDate, pct, flag, countryName } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/analytics", title: t("Analytics"),
  description: t("Knockout rates by division, when fights end, the biggest upsets, leading nations and the longest win streaks across every professional bout in the database."),
}));

export default async function Analytics() {
  const t = await getT();
  const w = await getWorld();
  const o = A.overview(w);
  const wc = A.byWeightClass(w);
  const ms = A.methodSplit(w);
  const years = A.boutsPerYear(w);
  const heat = A.finishHeat(w);
  const ups = A.biggestUpsets(w, 6);
  const countries = A.countryLeaders(w).slice(0, 8);
  const stance = A.stanceEdge(w);
  const reach = A.reachEdge(w);
  const streaks = A.longestStreaks(w, 6);
  const rounds = A.finishRoundHistogram(w);

  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">{t("Insights engine")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Analytics")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("What {n} professional bouts actually say about the sport.", { n: o.bouts.toLocaleString("en-US") })}</p>
        <p className="mt-3"><Link href="/accountability" className="chip !border-gold/40 hover:!text-gold">{t("How good is the win model? See its track record")}</Link></p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Fighters")} value={o.boxers} sub={t.n(o.countries, "{n} country", "{n} countries")} />
        <Stat label={t("Bouts")} value={o.bouts.toLocaleString("en-US")} sub={t.n(o.events, "{n} event", "{n} events")} />
        <Stat label={t("Finish rate")} value={pct(o.finishRate, 1)} sub={t("KO/TKO")} />
        <Stat label={t("Reach edge")} value={pct(reach.winPct, 1)} sub={t("longer-armed wins ({n} fights, 5cm+ gap)", { n: reach.fights })} />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5"><div className="eyebrow mb-3">{t("KO rate by division")}</div>
          <BarList rows={wc.map((r) => ({ label: t(r.weightClass), value: r.koRate, sub: t.n(r.bouts, "{n} bout", "{n} bouts") }))} fmt={(v) => pct(v)} /></div>
        <div className="card p-5"><div className="eyebrow mb-3">{t("How fights end")}</div>
          <Donut center={{ big: pct(o.finishRate), small: t("FINISHED") }} parts={[
            { label: t("KO"), value: ms.KO, color: "#e5322d" }, { label: t("TKO"), value: ms.TKO, color: "#ff8a3d" }, { label: t("Corner retirement"), value: ms.RTD, color: "#c2410c" },
            { label: t("Unanimous"), value: ms.UD, color: "#d9b25f" }, { label: t("Split"), value: ms.SD, color: "#4a8cff" }, { label: t("Majority"), value: ms.MD, color: "#7ee0b4" },
            { label: t("Technical decision"), value: ms.TD, color: "#a78bfa" }, { label: t("Disqualification"), value: ms.DQ, color: "#f472b6" }, { label: t("Draw"), value: ms.DRAW + ms.TDRAW, color: "#8d8d99" },
          ]} />
          <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-panel2 p-3"><div className="text-xs text-muted">{t("Southpaw win rate")}</div><div className="font-display text-2xl font-bold">{pct(stance.southpaw, 1)}</div></div>
            <div className="rounded-xl bg-panel2 p-3"><div className="text-xs text-muted">{t("Orthodox win rate")}</div><div className="font-display text-2xl font-bold">{pct(stance.orthodox, 1)}</div></div>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-1">{t("When knockouts land")}</div>
        <p className="mb-4 text-sm text-muted">{t("Share of each division’s finishes by round. Brighter = more stoppages. Heavier divisions end early; lighter ones grind.")}</p>
        <Heatmap label={t("When knockouts land")} rows={heat.map((h) => ({ label: t(h.weightClass), cells: h.cells, total: h.total }))} cols={Array.from({ length: 12 }, (_, i) => String(i + 1))} />
        <div className="mt-4 text-xs text-muted">{t("Overall: round 1 accounts for {p} of all stoppages.", { p: pct(rounds[0] / Math.max(1, rounds.reduce((a, b) => a + b, 0))) })}</div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5"><div className="eyebrow mb-3">{t("Bouts per year")} <span className="text-red-ink">· {t("KO share")}</span></div>
          <ColumnChart data={years.map((y) => ({ label: y.year, a: y.total, b: y.ko }))} />
          <div className="ltr-fixed mt-1 flex justify-between text-xs text-muted"><span>{years[0]?.year}</span><span>{years[years.length - 1]?.year}</span></div></div>
        <div className="card p-5"><div className="eyebrow mb-3">{t("Nations")}</div>
          <BarList rows={countries.map((c) => ({ label: `${flag(c.country)} ${countryName(c.country, t.locale)}`, value: c.wins, sub: t.n(c.boxers, "{n} fighter · {rate} win rate", "{n} fighters · {rate} win rate", { rate: pct(c.winRate) }) }))} color="var(--gold)" /></div>
      </section>

      <section>
        <SectionTitle eyebrow={t("By rating gap")} title={t("Biggest upsets")} />
        <div className="grid gap-3 md:grid-cols-2">
          {ups.map((u) => {
            const win = w.byId.get(u.bout.winnerId!)!;
            const lose = w.byId.get(u.bout.winnerId === u.bout.redId ? u.bout.blueId : u.bout.redId)!;
            return (
              <Link key={u.bout.id} href={`/events/${u.bout.eventId}`} className="card card-hover flex items-center gap-3 p-4">
                <Headshot boxer={win} size={48} />
                <div className="min-w-0 flex-1 text-sm"><div>{t.rich("<b>{winner}</b> <m>beat</m> {loser}", { winner: t.name(win.name), loser: t.name(lose.name), b: (c) => <b>{c}</b>, m: (c) => <span className="text-muted">{c}</span> })}</div><div className="text-xs text-muted">{fmtDate(u.bout.date, undefined, t.locale)} · {u.bout.method ? t(u.bout.method) : ""}</div></div>
                <div className="text-end"><div className="font-display text-2xl font-bold text-gold tabular">+{Math.round(u.gap)}</div><div className="text-xs uppercase tracking-widest text-muted">{t("Elo gap")}</div></div>
              </Link>
            );
          })}
        </div>
      </section>

      <section>
        <SectionTitle eyebrow={t("Records")} title={t("Longest win streaks")} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {streaks.map((s) => (
            <Link key={s.boxer.id} href={`/boxers/${s.boxer.slug}`} className="card card-hover flex items-center gap-3 p-3">
              <Headshot boxer={s.boxer} size={48} /><div className="flex-1 text-sm"><b>{t.name(s.boxer.name)}</b><div className="text-xs text-muted">{t(s.boxer.weightClass)}</div></div>
              <div className="font-display text-3xl font-bold text-win tabular">{s.len}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

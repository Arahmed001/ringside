import { ScrollRegion } from "@/components/ScrollRegion";
import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { broadcasterTable, compact, moneyCoverage, revenueByYear, topEarners, topGates, topPpv, topPurses, usd } from "@/lib/money";
import { BarList } from "@/components/charts";
import { BasisChip } from "@/components/Money";
import { Headshot } from "@/components/Portrait";
import { SectionTitle, Stat } from "@/components/ui";
import { fmtDate, pct } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/money", title: t("Fight money"),
  description: t("Biggest gates, pay-per-view sales, fighter purses and career earnings, and which broadcasters show the fights. Every figure says how it is known and where it came from."),
}));

const PLATFORM = { ppv: msg("pay-per-view"), streaming: msg("streaming"), subscription: msg("subscription TV"), "free-tv": msg("free TV") } as const;

export default async function Money() {
  const t = await getT();
  const w = await getWorld();
  const cov = moneyCoverage(w);
  const years = revenueByYear(w);
  const gates = topGates(w, 8), ppv = topPpv(w, 8), purses = topPurses(w, 10), earners = topEarners(w, 10), casters = broadcasterTable(w);
  const thisYear = Number(w.today.slice(0, 4));
  const yearsWith = [...new Set(years.map((y) => y.year))].sort((a, b) => b - a);
  const focus = yearsWith.includes(thisYear) ? thisYear : yearsWith[0];
  const yearEarners = focus ? topEarners(w, 8, focus) : [];
  const totalGate = years.reduce((s, y) => s + y.gate, 0), totalPpv = years.reduce((s, y) => s + y.ppv, 0), totalBuys = years.reduce((s, y) => s + y.ppvBuys, 0);
  const mainOf = (id: number) => (w.boutsByEvent.get(id) ?? []).find((b) => b.status !== "cancelled");
  const title = (id: number, fallback: string) => { const m = mainOf(id); return m ? t("{a} vs {b}", { a: t.name(m.redName), b: t.name(m.blueName) }) : t.name(fallback); };

  if (!cov.withFinancials && !cov.purses) {
    return (
      <div className="space-y-6">
        <div><div className="eyebrow mb-2">{t("Gates, pay-per-view and purses")}</div><h1 className="font-display text-5xl font-extrabold uppercase">{t("Fight money")}</h1></div>
        <p className="card p-6 text-muted">{t.rich("No financial figures are loaded yet. They arrive with a data feed that carries them, or from the research pipeline (see <c>docs/research.md</c>).", { c: (x) => <code lang="en" dir="ltr" className="rounded bg-panel2 px-1.5 py-0.5 text-sm">{x}</code> })}</p>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">{t("Gates, pay-per-view and purses")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Fight money")}</h1>
        <p className="mt-2 max-w-3xl text-muted">{t("What the sport takes in and who gets paid. Every figure carries a badge saying how it is known (official record, press report or estimate) and a link to its source where one exists.")}</p>
        <p className="mt-2 max-w-3xl text-xs text-muted">
          {t("Coverage: {withFin} of {events} completed cards have gate or PPV figures and {purses} purses are on file ({disclosed} official, {reported} reported, {estimated} estimated). Rankings below cover only what is on file.", {
            withFin: cov.withFinancials.toLocaleString("en-US"), events: cov.events.toLocaleString("en-US"), purses: cov.purses.toLocaleString("en-US"),
            disclosed: cov.basis.disclosed.toLocaleString("en-US"), reported: cov.basis.reported.toLocaleString("en-US"), estimated: cov.basis.estimated.toLocaleString("en-US"),
          })}
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Live gates")} value={usd(totalGate)} sub={t("across {n} cards", { n: cov.withFinancials.toLocaleString("en-US") })} />
        <Stat label={t("PPV revenue")} value={usd(totalPpv)} sub={t("{n} buys", { n: compact(totalBuys) })} />
        <Stat label={t("Purses on file")} value={cov.purses.toLocaleString("en-US")} sub={t("{pct}% official", { pct: Math.round((cov.basis.disclosed / Math.max(1, cov.purses)) * 100) })} />
        <Stat label={t("Biggest purse")} value={purses[0] ? usd(purses[0].purse.totalUsd) : "–"} sub={purses[0] ? t.name(purses[0].boxer.name) : undefined} />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="card min-w-0 p-5">
          <SectionTitle eyebrow={t("Ticket revenue")} title={t("Biggest live gates")} />
          <ol className="space-y-3">
            {gates.map((g, i) => (
              <li key={g.event.id} className="flex items-center gap-3 text-sm">
                <span className="w-5 text-center font-display text-lg font-bold text-gold">{i + 1}</span>
                <div className="min-w-0 flex-1"><Link href={`/events/${g.event.id}`} className="block truncate font-semibold hover:text-gold">{title(g.event.id, g.event.name)}</Link>
                  <div className="text-xs text-muted">{fmtDate(g.event.date, { month: "short", year: "numeric" }, t.locale)} · {t.name(g.event.venue)}{g.money.ticketsSold ? ` · ${t("{n} tickets", { n: g.money.ticketsSold.value.toLocaleString("en-US") })}` : ""}</div></div>
                <b className="tabular">{usd(g.value)}</b><BasisChip p={g.prov} />
              </li>
            ))}
          </ol>
        </div>
        <div className="card min-w-0 p-5">
          <SectionTitle eyebrow={t("Pay-per-view")} title={t("PPV leaders")} />
          <ol className="space-y-3">
            {ppv.map((g, i) => (
              <li key={g.event.id} className="flex items-center gap-3 text-sm">
                <span className="w-5 text-center font-display text-lg font-bold text-gold">{i + 1}</span>
                <div className="min-w-0 flex-1"><Link href={`/events/${g.event.id}`} className="block truncate font-semibold hover:text-gold">{title(g.event.id, g.event.name)}</Link>
                  <div className="text-xs text-muted">{fmtDate(g.event.date, { month: "short", year: "numeric" }, t.locale)}{g.money.ppvRevenueUsd ? ` · ${t("{amount} revenue", { amount: usd(g.money.ppvRevenueUsd.value) })}` : ""}</div></div>
                <b className="tabular">{t("{n} buys", { n: compact(g.value) })}</b><BasisChip p={g.prov} />
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="card min-w-0 p-5">
          <SectionTitle eyebrow={t("One night's pay")} title={t("Highest purses")} />
          <ol className="space-y-2.5">
            {purses.map((p, i) => (
              <li key={`${p.bout.id}-${p.boxer.id}`} className="flex items-center gap-3 text-sm">
                <span className="w-5 text-center font-display text-lg font-bold text-gold">{i + 1}</span>
                <Headshot boxer={p.boxer} size={32} rounded={false} className="rounded-full object-cover" />
                <div className="min-w-0 flex-1"><Link href={`/boxers/${p.boxer.slug}`} className="block truncate font-semibold hover:text-gold">{t.name(p.boxer.name)}</Link>
                  <Link href={`/bouts/${p.bout.id}`} className="block truncate text-xs text-muted hover:text-ink">{t("vs {name}, {date}", { name: t.name(p.bout.redId === p.boxer.id ? p.bout.blueName : p.bout.redName), date: fmtDate(p.event.date, { month: "short", year: "numeric" }, t.locale) })}</Link></div>
                <b className="tabular">{usd(p.purse.totalUsd)}</b><BasisChip p={p.purse} />
              </li>
            ))}
          </ol>
        </div>
        <div className="card min-w-0 p-5">
          <SectionTitle eyebrow={t("Career pay from purses")} title={t("Top earners")} />
          <ol className="space-y-2.5">
            {earners.map((e, i) => (
              <li key={e.boxer.id} className="flex items-center gap-3 text-sm">
                <span className="w-5 text-center font-display text-lg font-bold text-gold">{i + 1}</span>
                <Headshot boxer={e.boxer} size={32} rounded={false} className="rounded-full object-cover" />
                <div className="min-w-0 flex-1"><Link href={`/boxers/${e.boxer.slug}`} className="block truncate font-semibold hover:text-gold">{t.name(e.boxer.name)}</Link>
                  <div className="text-xs text-muted">{t.n(e.fights, "{n} purse", "{n} purses")} · {t("{pct}% official", { pct: Math.round(e.disclosedShare * 100) })}</div></div>
                <b className="tabular">{usd(e.total)}</b>
              </li>
            ))}
          </ol>
          {focus && yearEarners.length > 0 && (
            <>
              <div className="eyebrow mb-2 mt-6">{t("Top earners in {year}", { year: focus })}</div>
              <BarList rows={yearEarners.map((e) => ({ label: t.name(e.boxer.name), value: e.total, sub: t.n(e.fights, "{n} purse", "{n} purses") }))} fmt={usd} color="var(--gold)" />
            </>
          )}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="card min-w-0 p-5">
          <SectionTitle eyebrow={t("Who shows the fights")} title={t("Broadcasters")} />
          <ScrollRegion label={t("Broadcasters")}>
            <table className="w-full text-sm" aria-label={t("Broadcasters")}>
              <thead><tr className="text-start text-xs font-normal uppercase tracking-widest text-muted"><th className="py-2 text-start font-normal">{t("Broadcaster")}</th><th className="text-start font-normal">{t("Type")}</th><th className="text-end font-normal">{t("Cards")}</th><th className="text-end font-normal">{t("Avg audience")}</th><th className="text-end font-normal">{t("PPV buys")}</th></tr></thead>
              <tbody>
                {casters.map((c) => (
                  <tr key={c.broadcaster} className="border-t border-line/60">
                    <td className="py-2.5 font-semibold">{t.name(c.broadcaster)}</td>
                    <td className="text-muted">{t(PLATFORM[c.platform])}</td>
                    <td className="text-end tabular">{c.events}</td>
                    <td className="text-end tabular">{c.avgViewers ? compact(c.avgViewers) : "–"}</td>
                    <td className="text-end tabular">{c.ppvBuys ? compact(c.ppvBuys) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </div>
        <div className="card min-w-0 p-5">
          <SectionTitle eyebrow={t("Year by year")} title={t("Gate and PPV revenue")} />
          <BarList rows={years.map((y) => ({ label: String(y.year), value: y.gate + y.ppv, sub: t("{gate} gate · {ppv} PPV · {n} cards", { gate: usd(y.gate), ppv: usd(y.ppv), n: y.events }) }))} fmt={usd} color="var(--gold)" />
          <p className="mt-3 text-xs text-muted">{t("Only cards with figures on file are counted, so a year can look small because data is thin, not because the money was.")}</p>
        </div>
      </section>
      <p className="text-xs text-muted">{pct(cov.withFinancials / Math.max(1, cov.events))} {t("of completed cards have financial figures.")}</p>
    </div>
  );
}

import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";
import type { World } from "@/lib/world";
import type { BoxerFull, EventRow, Provenance } from "@/lib/types";
import { boutPurses, careerMoney, compact, eventMoney, grossOf, usd } from "@/lib/money";
import { countryName, fmtDate } from "@/lib/format";

const BASIS_LABEL = { disclosed: msg("Official"), reported: msg("Reported"), estimated: msg("Estimated") } as const;
const BASIS_HELP = {
  disclosed: msg("From an official record: a commission disclosure, a company filing or the promoter’s own statement."),
  reported: msg("Published by a named outlet that cited people or documents."),
  estimated: msg("An outlet’s or analyst’s estimate, or worked out from other figures. Treat as approximate."),
} as const;
const BASIS_STYLE = { disclosed: "!border-win/40 !text-win", reported: "", estimated: "!border-dashed" } as const;

/** Where a figure comes from, next to the figure: the basis, the source, and a link when there is one. */
export async function BasisChip({ p }: { p: Provenance }) {
  const t = await getT();
  const tip = `${t(BASIS_HELP[p.basis])} ${t("Source: {source}", { source: p.source })}${p.retrievedAt ? ` · ${fmtDate(p.retrievedAt, undefined, t.locale)}` : ""}${p.note ? ` · ${p.note}` : ""}`;
  const cls = `chip !px-2 !py-0 text-xs ${BASIS_STYLE[p.basis]}`;
  return p.sourceUrl
    ? <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" title={tip} className={`${cls} hover:text-ink`}>{t(BASIS_LABEL[p.basis])} ↗</a>
    : <span title={tip} className={cls}>{t(BASIS_LABEL[p.basis])}</span>;
}

async function Cell({ label, value, sub, p }: { label: string; value: string; sub?: string; p?: Provenance }) {
  return (
    <div className="rounded-xl bg-panel2/60 p-3">
      <div className="text-xs uppercase tracking-widest text-muted">{label}</div>
      <div className="font-display text-2xl font-bold leading-tight tabular">{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">{sub && <span>{sub}</span>}{p && <BasisChip p={p} />}</div>
    </div>
  );
}

/** Gate, tickets, pay-per-view, site fee, broadcasters and purses for one card, each figure with its own source. */
export async function EventMoney({ w, event }: { w: World; event: EventRow }) {
  const t = await getT();
  const { fields: f, broadcasts } = eventMoney(w, event.id);
  const bouts = (w.boutsByEvent.get(event.id) ?? []).filter((b) => b.status !== "cancelled");
  const purseRows = bouts.map((b) => ({ b, purses: boutPurses(w, b.id) })).filter((x) => x.purses.size).slice(0, 6);
  if (!Object.keys(f).length && !broadcasts.length && !purseRows.length) return null;
  const gross = grossOf(f);
  const sold = f.ticketsSold?.value, cap = f.capacity?.value;
  return (
    <section className="card mt-8 p-5" aria-labelledby={`money-${event.id}`}>
      <div className="eyebrow mb-3" id={`money-${event.id}`}>{t("The money")}</div>
      {Object.keys(f).length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {f.gateUsd && <Cell label={t("Live gate")} value={usd(f.gateUsd.value)} p={f.gateUsd.prov} />}
          {sold !== undefined && <Cell label={t("Tickets sold")} value={sold.toLocaleString("en-US")} sub={cap ? (sold >= cap * 0.99 ? t("sold out · capacity {n}", { n: cap.toLocaleString("en-US") }) : t("of {n} seats", { n: cap.toLocaleString("en-US") })) : undefined} p={f.ticketsSold!.prov} />}
          {f.siteFeeUsd && <Cell label={t("Site fee")} value={usd(f.siteFeeUsd.value)} sub={t("paid to host the card")} p={f.siteFeeUsd.prov} />}
          {f.ppvBuys && <Cell label={t("PPV buys")} value={compact(f.ppvBuys.value)} sub={f.ppvPriceUsd ? t("at ${price} each", { price: f.ppvPriceUsd.value.toFixed(2) }) : undefined} p={f.ppvBuys.prov} />}
          {(f.ppvRevenueUsd || (f.ppvBuys && f.ppvPriceUsd)) && <Cell label={t("PPV revenue")} value={usd(f.ppvRevenueUsd?.value ?? Math.round(f.ppvBuys!.value * f.ppvPriceUsd!.value))} p={(f.ppvRevenueUsd ?? f.ppvBuys)!.prov} />}
          {f.sponsorshipUsd && <Cell label={t("Sponsorship")} value={usd(f.sponsorshipUsd.value)} p={f.sponsorshipUsd.prov} />}
          {gross > 0 && [f.gateUsd, f.siteFeeUsd, f.ppvRevenueUsd ?? (f.ppvBuys && f.ppvPriceUsd), f.sponsorshipUsd].filter(Boolean).length > 1 && <Cell label={t("Total gross")} value={usd(gross)} sub={t("gate + PPV + site fee + sponsors")} />}
        </div>
      )}
      {broadcasts.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs uppercase tracking-widest text-muted">{t("Where it aired")}</div>
          <ul className="flex flex-wrap gap-2">
            {broadcasts.map((b) => (
              <li key={`${b.broadcaster}|${b.region}`} className="flex items-center gap-2 rounded-xl bg-panel2/60 px-3 py-2 text-sm">
                <b>{t.name(b.broadcaster)}</b>
                <span className="text-xs text-muted">{b.region ? `${countryName(b.region, t.locale) !== b.region ? countryName(b.region, t.locale) : t.name(b.region)} · ` : ""}{t(b.platform === "ppv" ? "pay-per-view" : b.platform === "streaming" ? "streaming" : b.platform === "subscription" ? "subscription TV" : "free TV")}</span>
                {b.viewersAvg && <span className="tabular text-xs text-gold">{t("{n} avg viewers", { n: compact(b.viewersAvg) })}</span>}
                <BasisChip p={b} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {purseRows.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs uppercase tracking-widest text-muted">{t("Fighter purses")}</div>
          <ul className="divide-y divide-line/60 text-sm">
            {purseRows.map(({ b, purses }) => (
              <li key={b.id} className="grid gap-x-4 gap-y-1 py-2 sm:grid-cols-2">
                {[w.byId.get(b.redId)!, w.byId.get(b.blueId)!].map((f2) => {
                  const p = purses.get(f2.id);
                  return (
                    <div key={f2.id} className="flex items-center justify-between gap-3">
                      <Link href={`/boxers/${f2.slug}`} className="min-w-0 truncate hover:text-gold">{t.name(f2.name)}</Link>
                      {p ? <span className="flex shrink-0 items-center gap-2"><b className="tabular">{usd(p.totalUsd)}</b>{p.bonusUsd ? <span className="text-xs text-muted">{t("incl. {amount} PPV share", { amount: usd(p.bonusUsd) })}</span> : null}<BasisChip p={p} /></span> : <span className="text-xs text-muted">{t("not disclosed")}</span>}
                    </div>
                  );
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-4 text-xs text-muted">{t("Every figure shows how it is known. Estimated figures are approximate; follow the source link to check.")}</p>
    </section>
  );
}

/** A fighter's pay: career total from purses, the biggest night, and year by year (with endorsements where a published list has them). */
export async function CareerMoneyCard({ w, boxer }: { w: World; boxer: BoxerFull }) {
  const t = await getT();
  const m = careerMoney(w, boxer.id);
  if (!m) return null;
  const peak = Math.max(...m.byYear.map((y) => y.ring + (y.offRing ?? 0)), 1);
  return (
    <section className="card p-5" aria-labelledby={`earn-${boxer.id}`}>
      <div className="eyebrow mb-1" id={`earn-${boxer.id}`}>{t("Earnings")}</div>
      <div className="font-display text-4xl font-extrabold tabular">{usd(m.total)}</div>
      <div className="text-xs text-muted">{t.n(m.fights, "{n} purse on record", "{n} purses on record")} · {t("{pct}% from official records", { pct: Math.round(m.disclosedShare * 100) })}</div>
      {m.biggest && (
        <div className="mt-3 text-sm">
          {t("Biggest night:")} <b className="tabular">{usd(m.biggest.purse.totalUsd)}</b>{" "}
          <Link href={`/bouts/${m.biggest.bout.id}`} className="text-muted hover:text-gold">{t("vs {name}, {date}", { name: t.name(m.biggest.bout.redId === boxer.id ? m.biggest.bout.blueName : m.biggest.bout.redName), date: fmtDate(m.biggest.event.date, { month: "short", year: "numeric" }, t.locale) })}</Link>
          {" "}<BasisChip p={m.biggest.purse} />
        </div>
      )}
      <ul className="ltr-fixed mt-4 space-y-1.5" dir="ltr">
        {m.byYear.slice(-8).map((y) => (
          <li key={y.year} className="flex items-center gap-2 text-xs">
            <span className="w-9 tabular text-muted">{y.year}</span>
            <span className="flex h-3 flex-1 overflow-hidden rounded-full bg-panel2" title={y.fromList ? y.source : undefined}>
              <span className="h-full bg-gold/80" style={{ width: `${(y.ring / peak) * 100}%` }} />
              {y.offRing ? <span className="h-full bg-gold/35" style={{ width: `${(y.offRing / peak) * 100}%` }} /> : null}
            </span>
            <span className="w-14 text-end tabular">{usd(y.ring + (y.offRing ?? 0))}</span>
            <span className={`w-3 shrink-0 text-center text-xs ${y.basis === "disclosed" ? "text-win" : "text-muted"}`} aria-hidden>{y.basis === "disclosed" ? "●" : y.basis === "reported" ? "◐" : "○"}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">{t("Bars: ring pay (solid) and, where a published list has it, endorsements and other income (light). ● official, ◐ reported, ○ estimated.")}</p>
    </section>
  );
}

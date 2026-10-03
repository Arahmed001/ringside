import Link from "@/components/L";
import type { World } from "@/lib/world";
import type { LiveRecord } from "@/lib/ledger";
import { Stat } from "@/components/ui";
import { fmtDate, pct } from "@/lib/format";
import { getT } from "@/lib/i18n/server";

const MIN_GRADED = 30; // below this a percentage says more about luck than about the model

/** Predictions written down before each fight and graded after it (lib/ledger.ts). Shown above the backtest because it is the real thing. */
export async function LiveLedger({ w, rec }: { w: World; rec: LiveRecord }) {
  const t = await getT();
  const d = (s: string | null) => (s ? fmtDate(s, undefined, t.locale) : "–");
  const g = rec.graded;
  const nextDate = rec.pending[0]?.eventDate ?? null;
  const name = (id: number) => t.name(w.byId.get(id)?.name ?? "");
  const recent = [...rec.calls].reverse().slice(0, 8);
  return (
    <section className="space-y-5">
      <div>
        <div className="eyebrow mb-2">{t("Live ledger")}</div>
        <h2 className="font-display text-3xl font-bold uppercase">{t("Predictions written down before the fight")}</h2>
        <p className="mt-2 max-w-3xl text-sm text-ink/90">{t("Every day the server runs, Ringside records its win probability for each upcoming fight and never edits it. A fight is graded on the last prediction made before the event, and only fights with a prediction on file count: a fight that first appeared after it was over is never claimed.")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label={t("Fights with a prediction on file")} value={rec.locked.toLocaleString("en-US")} sub={t("Since {date}", { date: d(rec.firstLockedOn) })} />
        <Stat label={t("Awaiting the fight")} value={rec.pending.length.toLocaleString("en-US")} sub={nextDate ? t("Next event {date}", { date: d(nextDate) }) : t("No upcoming fights on file")} />
        <Stat label={t("Graded")} value={g.n.toLocaleString("en-US")} sub={g.n ? t("{p} picked the winner · higher rating won {e}", { p: pct(g.accuracy, 1), e: pct(g.eloAccuracy, 1) }) : nextDate ? t("The first results are graded after {date}", { date: d(nextDate) }) : t("Nothing to grade yet")} />
      </div>
      {g.n > 0 && g.n < MIN_GRADED && <p className="text-sm text-muted">{t("Too few graded fights to judge the model yet (under {n}).", { n: MIN_GRADED })}</p>}
      {g.n > 0 && (
        <ul className="space-y-2">
          {recent.map((c) => (
            <li key={c.boutId}>
              <Link href={`/bouts/${c.boutId}`} className="card flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 transition hover:bg-panel2/70">
                <span className="font-semibold">{t("{a} vs {b}", { a: name(c.redId), b: name(c.blueId) })}</span>
                <span className="tabular text-sm text-muted">
                  {d(c.eventDate)} · {t("Called {name} at {p}", { name: name(c.pickedRed ? c.redId : c.blueId), p: pct(Math.max(c.pRed, 1 - c.pRed)) })} · <span className={c.correct ? "text-win" : "text-red-ink"}>{c.correct ? t("Right") : t("Wrong")}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rec.pending.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">{t("Next fights on file")}</h3>
          <ul className="grid gap-2 md:grid-cols-2">
            {rec.pending.slice(0, 6).map((p) => {
              const b = w.boutById.get(p.boutId)!;
              return (
                <li key={p.boutId}>
                  <Link href={`/bouts/${p.boutId}`} className="card flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 transition hover:bg-panel2/70">
                    <span className="font-semibold">{t("{a} vs {b}", { a: name(b.redId), b: name(b.blueId) })}</span>
                    <span className="tabular text-sm text-muted">{d(p.eventDate)} · <b className="text-red-ink">{pct(p.pRed)}</b> / <b className="text-blue">{pct(1 - p.pRed)}</b></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

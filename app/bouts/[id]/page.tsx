import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getWorld, recordStr } from "@/lib/world";
import { Headshot } from "@/components/Portrait";
import { ScoreCards } from "@/components/ScoreCards";
import { PunchStats } from "@/components/PunchStats";
import { SectionTitle } from "@/components/ui";
import { flag, fmtDate, methodLabel } from "@/lib/format";
import type { PunchLine } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const w = await getWorld();
  const b = w.bouts.find((x) => x.id === Number(id));
  return { title: b ? `${b.redName} vs ${b.blueName}` : "Bout" };
}

type Fighter = NonNullable<Awaited<ReturnType<typeof getWorld>>["byId"] extends Map<number, infer V> ? V : never>;

function Side({ f, color, win }: { f: Fighter; color: string; win: boolean }) {
  return (
    <Link href={`/boxers/${f.slug}`} className="flex flex-col items-center gap-2 text-center">
      <div className="relative"><Headshot boxer={f} size={110} />{win && <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-win px-2 py-0.5 text-[10px] font-bold text-bg">WINNER</span>}</div>
      <div className="font-display text-3xl font-bold leading-tight" style={{ color }}>{f.name}</div>
      <div className="text-xs text-muted">{flag(f.country)} {recordStr(f)} · {f.stance}</div>
    </Link>
  );
}

const lb = (n: number | null) => (n === null ? "–" : `${n.toFixed(1)} lb`);
const implied = (a: number | null, b: number | null) => (a && b ? (1 / a) / (1 / a + 1 / b) : null);

export default async function BoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const w = await getWorld();
  const b = w.bouts.find((x) => x.id === Number(id));
  if (!b) notFound();
  const red = w.byId.get(b.redId)!, blue = w.byId.get(b.blueId)!;
  const ev = w.events.find((e) => e.id === b.eventId)!;
  const body = b.titleOrgId ? w.orgs.get(b.titleOrgId) : null;
  const wins = w.weighInsByBout.get(b.id) ?? [];
  const wr = wins.find((x) => x.boxerId === red.id), wb = wins.find((x) => x.boxerId === blue.id);
  const offs = w.officialsByBout.get(b.id) ?? [];
  const ref = offs.find((o) => o.role === "referee");
  const cards = (w.scorecardsByBout.get(b.id) ?? []).map((c) => ({ seat: c.seat, judge: w.people.get(c.judgeId)?.name ?? "?", judgeSlug: w.people.get(c.judgeId)?.slug ?? "", red: c.red, blue: c.blue }));
  const corners = w.cornersByBout.get(b.id) ?? [];
  const pre = w.boutPre.get(b.id);
  const eloP = pre ? 1 / (1 + Math.pow(10, (pre.blue - pre.red) / 400)) : null;
  const mkt = implied(b.oddsRed, b.oddsBlue);
  const db = await getDb();
  const punches = (db.prepare("SELECT bout_id AS boutId, boxer_id AS boxerId, round, thrown, landed, power_thrown AS powerThrown, power_landed AS powerLanded, jab_thrown AS jabThrown, jab_landed AS jabLanded FROM punch_stats WHERE bout_id = ? ORDER BY round").all(b.id)) as unknown as PunchLine[];
  const winner = b.winnerId ? (b.winnerId === red.id ? red : blue) : null;
  const trainerOf = (boxerId: number) => { const c = corners.find((x) => x.boxerId === boxerId && x.role === "head_trainer"); return c ? w.people.get(c.personId) : null; };

  return (
    <div className="space-y-10">
      <section className="rise">
        <div className="eyebrow mb-2">
          <Link href={`/events/${ev.id}`} className="hover:text-ink">{ev.name}</Link> · {fmtDate(ev.date)} · {ev.venue}, {ev.city}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/rankings/${b.weightClass.toLowerCase().replace(/\s+/g, "-")}`} className="chip">{b.weightClass}</Link>
          <span className="chip">{b.rounds} rounds</span>
          {b.contractLb && <span className="chip !border-gold/40 !text-gold">Catchweight {b.contractLb} lb</span>}
          {b.title && <span className="chip !border-gold/50 !text-gold">{body ? <Link href={`/orgs/${body.slug}`}>{body.name.match(/\(([^)]+)\)/)?.[1] ?? body.name}</Link> : null} {b.title}{b.titleVacant ? " (vacant)" : ""}</span>}
          {ev.broadcaster && <span className="chip">{ev.broadcaster}</span>}
          {ev.attendance && <span className="chip">{ev.attendance.toLocaleString()} attended</span>}
        </div>

        <div className="card mt-5 p-6">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <Side f={red} color="#e5322d" win={winner?.id === red.id} />
            <div className="text-center">
              <div className="font-display text-3xl font-extrabold text-gold">VS</div>
              {b.method && (
                <div className="mt-3">
                  <div className="font-display text-2xl font-bold">{b.method === "DRAW" ? "Draw" : methodLabel(b.method, b.endRound)}</div>
                  {b.roundTime && b.endRound && <div className="text-xs text-muted">{b.method === "KO" || b.method === "TKO" ? `Round ${b.endRound}, ${b.roundTime}` : `${b.rounds} rounds`}</div>}
                </div>
              )}
            </div>
            <Side f={blue} color="#4a8cff" win={winner?.id === blue.id} />
          </div>
          {(b.kdRed > 0 || b.kdBlue > 0) && (
            <div className="mt-5 flex justify-center gap-2 text-xs">
              {b.kdRed > 0 && <span className="chip !border-red/50 !text-red">{red.name.split(" ").slice(-1)[0]} down {b.kdRed}×</span>}
              {b.kdBlue > 0 && <span className="chip !border-blue/50 !text-blue">{blue.name.split(" ").slice(-1)[0]} down {b.kdBlue}×</span>}
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <div className="eyebrow mb-3">Weigh-in</div>
          {wr && wb ? (
            <div className="overflow-hidden rounded-xl border border-line/60 text-sm">
              {([
                ["Official weight", lb(wr.officialLb), lb(wb.officialLb)],
                ["Limit", lb(wr.limitLb), lb(wb.limitLb)],
                ["Fight night", lb(wr.fightNightLb), lb(wb.fightNightLb)],
                ["Rehydration", wr.fightNightLb && wr.officialLb ? `+${(wr.fightNightLb - wr.officialLb).toFixed(1)} lb` : "–", wb.fightNightLb && wb.officialLb ? `+${(wb.fightNightLb - wb.officialLb).toFixed(1)} lb` : "–"],
              ] as [string, string, string][]).map(([k, x, y]) => (
                <div key={k} className="grid grid-cols-3 items-center border-t border-line/60 px-4 py-2 first:border-0"><span className="tabular font-semibold">{x}</span><span className="text-center text-xs uppercase tracking-widest text-muted">{k}</span><span className="text-right tabular font-semibold">{y}</span></div>
              ))}
              {(wr.madeWeight === false || wb.madeWeight === false) && (
                <div className="border-t border-line/60 bg-red/10 px-4 py-2 text-xs text-red">
                  Missed weight: {[wr.madeWeight === false ? `${red.name} (+${((wr.officialLb ?? 0) - (wr.limitLb ?? 0)).toFixed(1)} lb)` : null, wb.madeWeight === false ? `${blue.name} (+${((wb.officialLb ?? 0) - (wb.limitLb ?? 0)).toFixed(1)} lb)` : null].filter(Boolean).join(" and ")}
                </div>
              )}
              {wr.fightNightLb && wb.fightNightLb && Math.abs(wr.fightNightLb - wb.fightNightLb) >= 4 && (
                <div className="border-t border-line/60 px-4 py-2 text-xs text-muted">{(wr.fightNightLb > wb.fightNightLb ? red : blue).name} weighed {Math.abs(wr.fightNightLb - wb.fightNightLb).toFixed(1)} lb more on fight night.</div>
              )}
            </div>
          ) : <p className="text-sm text-muted">No weigh-in data recorded for this bout yet.</p>}
        </div>

        <div className="card p-5">
          <div className="eyebrow mb-3">Corners &amp; officials</div>
          <dl className="space-y-2 text-sm">
            {[[red, "#e5322d"], [blue, "#4a8cff"]].map(([f, c]) => {
              const fr = f as typeof red; const t = trainerOf(fr.id);
              return <div key={fr.id} className="flex justify-between gap-3"><dt className="text-muted"><span style={{ color: c as string }}>{fr.name}</span> head trainer</dt><dd>{t ? <Link href={`/people/${t.slug}`} className="hover:text-gold">{t.name}</Link> : "–"}</dd></div>;
            })}
            <div className="flex justify-between gap-3 border-t border-line/60 pt-2"><dt className="text-muted">Referee</dt><dd>{ref ? <Link href={`/people/${w.people.get(ref.personId)?.slug}`} className="hover:text-gold">{w.people.get(ref.personId)?.name}</Link> : "–"}</dd></div>
            {cards.length === 0 && offs.filter((o) => o.role === "judge").map((o) => <div key={o.personId} className="flex justify-between gap-3"><dt className="text-muted">Judge {o.seat}</dt><dd>{w.people.get(o.personId)?.name}</dd></div>)}
          </dl>
          {oddsBlock(b.oddsRed, b.oddsBlue, mkt, eloP)}
        </div>
      </section>

      {cards.length > 0 && (
        <section><SectionTitle eyebrow="Official result" title="Scorecards" /><div className="card p-5"><ScoreCards cards={cards} redName={red.name} blueName={blue.name} /></div></section>
      )}

      {punches.length > 0 && (
        <section><SectionTitle eyebrow="Fight stats" title="Punch statistics" /><div className="card p-5"><PunchStats lines={punches} redId={red.id} blueId={blue.id} redName={red.name} blueName={blue.name} /></div></section>
      )}
    </div>
  );
}

function oddsBlock(oddsRed: number | null, oddsBlue: number | null, mkt: number | null, elo: number | null) {
  if (!oddsRed || !oddsBlue) return null;
  return (
    <div className="mt-4 border-t border-line/60 pt-3 text-sm">
      <div className="mb-1 flex justify-between"><span className="text-muted">Closing odds</span><span className="tabular"><b className="text-red">{oddsRed.toFixed(2)}</b> / <b className="text-blue">{oddsBlue.toFixed(2)}</b></span></div>
      {mkt !== null && <div className="flex justify-between text-xs text-muted"><span>Market implied (red)</span><span className="tabular">{Math.round(mkt * 100)}%{elo !== null ? ` · Elo says ${Math.round(elo * 100)}%` : ""}</span></div>}
    </div>
  );
}

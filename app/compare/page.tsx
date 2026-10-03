import type { Metadata } from "next";
import Link from "next/link";
import { getWorld, recordStr } from "@/lib/world";
import { predict, featuresOf } from "@/lib/predict";
import { MatchupLab } from "@/components/MatchupLab";
import { activeWeights } from "@/lib/model";
import { loadFit } from "@/lib/model-fit";
import { Headshot } from "@/components/Portrait";
import { ProbBar, Radar } from "@/components/charts";
import { archetype } from "@/lib/style";
import { SectionTitle } from "@/components/ui";
import { flag, pct } from "@/lib/format";
import { upcomingEvents, eventBouts } from "@/lib/events";
import type { BoxerFull } from "@/lib/types";

export const metadata: Metadata = { title: "Matchups" };

export default async function Compare({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const { a: sa, b: sb } = await searchParams;
  const w = await getWorld();
  const A = sa ? w.bySlug.get(sa) : undefined, B = sb ? w.bySlug.get(sb) : undefined;
  const options = [...w.boxers].filter((b) => b.bouts >= 5).sort((x, y) => x.name.localeCompare(y.name));

  const featured = upcomingEvents(w).slice(0, 3).flatMap((e) => eventBouts(w, e.id).slice(0, 2));

  return (
    <div className="space-y-10">
      <div>
        <div className="eyebrow mb-2">Fight predictor</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">Matchup lab</h1>
        <p className="mt-2 max-w-2xl text-muted">Pick any two fighters — even from different eras or weights — and see win probability, how the fight likely ends, and what drives the number.</p>
      </div>
      <form className="card grid gap-3 p-4 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-center">
        {(["a", "b"] as const).map((k, i) => (
          <div key={k} className={i === 1 ? "sm:col-start-3" : ""}>
            <select name={k} defaultValue={(k === "a" ? sa : sb) ?? ""} className="w-full rounded-xl border border-line bg-panel2 px-3 py-2.5 text-sm outline-none focus:border-gold/60">
              <option value="">Select fighter {k.toUpperCase()}…</option>
              {options.map((o) => <option key={o.id} value={o.slug}>{o.name} — {o.weightClass}</option>)}
            </select>
          </div>
        ))}
        <span className="hidden font-display text-xl font-bold text-gold sm:col-start-2 sm:row-start-1 sm:block">VS</span>
        <button className="rounded-xl bg-red px-6 py-2.5 font-display text-lg font-bold uppercase transition hover:brightness-110">Predict</button>
      </form>

      {A && B && A.id !== B.id ? <Result A={A} B={B} w={w} /> : (
        <section>
          <SectionTitle eyebrow="Or start from the calendar" title="Booked fights" />
          <div className="grid gap-3 sm:grid-cols-2">
            {featured.map((b) => (
              <Link key={b.id} href={`/compare?a=${b.redSlug}&b=${b.blueSlug}`} className="card card-hover flex items-center justify-between p-4">
                <span><b>{b.redName}</b> <span className="text-muted">vs</span> <b>{b.blueName}</b></span><span className="chip">{b.weightClass}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Result({ A, B, w }: { A: BoxerFull; B: BoxerFull; w: Awaited<ReturnType<typeof getWorld>> }) {
  const p = predict(A, B);
  const h2h = w.bouts.filter((x) => x.method && ((x.redId === A.id && x.blueId === B.id) || (x.redId === B.id && x.blueId === A.id)));
  const rows: [string, string, string][] = [
    ["Record", recordStr(A), recordStr(B)], ["KO rate", pct(A.koRate), pct(B.koRate)], ["Rating", String(Math.round(A.rating)), String(Math.round(B.rating))],
    ["Age", String(A.age), String(B.age)], ["Height", `${A.heightCm}cm`, `${B.heightCm}cm`], ["Reach", `${A.reachCm}cm`, `${B.reachCm}cm`],
    ["Stance", A.stance, B.stance], ["Style", archetype(A), archetype(B)], ["Division", A.weightClass, B.weightClass],
  ];
  const ax = (b: BoxerFull) => [
    { label: "Power", v: b.koRate }, { label: "Winning", v: b.winRate }, { label: "Durability", v: 1 - Math.min(1, (b.koLosses / Math.max(1, b.bouts)) * 4) },
    { label: "Reach", v: Math.min(1, Math.max(0, (b.reachCm - 150) / 60)) }, { label: "Experience", v: Math.min(1, b.bouts / 40) }, { label: "Rating", v: Math.min(1, Math.max(0, (b.rating - 1350) / 400)) },
  ];
  return (
    <section className="space-y-6">
      <div className="card p-6">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          {[A, B].map((f, i) => (
            <Link key={f.id} href={`/boxers/${f.slug}`} className={`flex flex-col items-center gap-2 text-center ${i === 1 ? "order-3" : ""}`}>
              <Headshot boxer={f} size={120} />
              <div className="font-display text-3xl font-bold leading-tight">{f.name}</div>
              <div className="text-xs text-muted">{flag(f.country)} {f.country}</div>
            </Link>
          ))}
          <div className="order-2 font-display text-4xl font-extrabold text-gold">VS</div>
        </div>
        <div className="mt-6"><ProbBar a={A.name} b={B.name} pA={p.pA} pB={p.pB} pDraw={p.pDraw} /></div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="chip !border-gold/40 !text-gold">✦ {p.confidence}</span><span className="chip">{Math.round(p.koProb * 100)}% chance of KO/TKO</span>{A.weightClass !== B.weightClass && <span className="chip !border-red/50 !text-red">Different divisions — treat with caution</span>}</div>
      </div>
      <MatchupLab a={{ name: A.name, features: featuresOf(A) }} b={{ name: B.name, features: featuresOf(B) }} defaults={activeWeights()}
        modelNote={(() => { const f = loadFit(); return f && f.recommended !== "plain Elo" ? `The rating weight is fitted on ${f.rows.train.toLocaleString()} past bouts (held-out log-loss ${f.test[f.recommended === "Elo refit" ? "eloOnly" : f.recommended === "all features" ? "full" : "selected"].logLoss.toFixed(3)} vs ${f.test.baseline.logLoss.toFixed(3)} for plain Elo). Other weights are hand-set; see Data & model for how each compares.` : "Weights are hand-set until real results are available to fit the model."; })()} />
      <div className="card flex items-center justify-center gap-2 p-5">
        <Radar axes={ax(A)} color="#e5322d" size={200} /><Radar axes={ax(B)} color="#4a8cff" size={200} />
      </div>
      <div className="card overflow-hidden">
        {rows.map(([k, x, y]) => (
          <div key={k} className="grid grid-cols-3 items-center border-t border-line/60 px-5 py-2.5 text-sm first:border-0"><span className="font-semibold tabular">{x}</span><span className="text-center text-xs uppercase tracking-widest text-muted">{k}</span><span className="text-right font-semibold tabular">{y}</span></div>
        ))}
      </div>
      {h2h.length > 0 && <div className="card p-5 text-sm"><div className="eyebrow mb-2">Head to head</div>{h2h.map((x) => <div key={x.id}>{x.date}: {x.winnerId ? w.byId.get(x.winnerId)!.name : "Draw"} by {x.method}</div>)}</div>}
    </section>
  );
}

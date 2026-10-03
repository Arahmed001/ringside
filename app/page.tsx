import Link from "next/link";
import { getWorld } from "@/lib/world";
import { overview, biggestUpsets } from "@/lib/analytics";
import { pound4pound } from "@/lib/rankings";
import { eventViews, isLive, upcomingEvents, recentEvents } from "@/lib/events";
import { currentYear } from "@/lib/clock";
import { predict } from "@/lib/predict";
import { DIVISIONS, slugifyDivision } from "@/lib/divisions";
import { Poster } from "@/components/Poster";
import { Headshot } from "@/components/Portrait";
import { ProbBar } from "@/components/charts";
import { PickEm } from "@/components/PickEm";
import { WatchlistStrip } from "@/components/Watch";
import { BoxerCard, SectionTitle } from "@/components/ui";
import { daysUntil, fmtDate, flag, methodLabel } from "@/lib/format";
import { recordStr } from "@/lib/world";

const EXAMPLES = [
  "knockout artists with 15+ KOs",
  "technicians with 20+ wins",
  "young heavyweights with reach over 190",
  "Japanese lightweights",
  "undefeated fighters",
];

export default async function Home() {
  const w = await getWorld();
  const o = overview(w);
  const ups = eventViews(w, upcomingEvents(w));
  const next = ups[0];
  const p = predict(next.red, next.blue);
  const p4p = pound4pound(w, 8);
  const recent = eventViews(w, recentEvents(w, 5));
  const upset = biggestUpsets(w.bouts.length ? { ...w, bouts: w.bouts.filter((b) => b.date >= `${currentYear() - 1}-01-01`) } : w, 1)[0];

  const pickBouts = next.bouts.filter(isLive).slice().reverse().map((b) => {
    const r = w.byId.get(b.redId)!, u = w.byId.get(b.blueId)!;
    const pr = predict(r, u);
    const redFav = pr.pA >= pr.pB;
    return { id: b.id, red: r.name, blue: u.name, redId: r.id, blueId: u.id, modelPickId: redFav ? r.id : u.id, modelPct: Math.round(Math.max(pr.pA, pr.pB) * 100), label: `${r.sex === "female" ? "W " : ""}${b.weightClass.replace("weight", "")}` };
  });

  const watchData = w.boxers.filter((b) => b.active).map((b) => {
    const up = (w.boutsByBoxer.get(b.id) ?? []).find((x) => x.upcoming);
    return { slug: b.slug, name: b.name, record: recordStr(b), next: up ? `${fmtDate(up.date, { month: "short", day: "numeric" })} vs ${up.redId === b.id ? up.blueName : up.redName}` : undefined };
  });

  return (
    <div className="space-y-16 overflow-x-clip">
      {/* Hero */}
      <section className="rise grid items-center gap-10 lg:grid-cols-[1.15fr_.85fr]">
        <div>
          <div className="eyebrow mb-3">Boxing intelligence · {o.boxers} fighters · {o.bouts.toLocaleString()} bouts</div>
          <h1 className="font-display text-6xl font-extrabold uppercase leading-[.92] sm:text-8xl">Every fighter.<br /><span className="text-red">Every number.</span></h1>
          <p className="mt-5 max-w-xl text-lg text-muted">Ratings, rankings, win-probabilities and AI scouting for the whole sport, in one place. Ask in plain English.</p>
          <form action="/boxers" className="mt-7 flex max-w-xl gap-2">
            <input name="q" placeholder="Try: knockout artists with 15+ KOs" className="min-w-0 flex-1 rounded-2xl border border-line bg-panel px-5 py-3.5 outline-none transition placeholder:text-muted/70 focus:border-gold/60" />
            <button className="rounded-2xl bg-red px-6 font-display text-lg font-bold uppercase tracking-wide transition hover:brightness-110">Ask</button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((q) => <Link key={q} href={`/boxers?q=${encodeURIComponent(q)}`} className="chip transition hover:text-ink">{q}</Link>)}
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-sm">
          <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-red/20 blur-3xl live" />
          <Link href={`/events/${next.event.id}`} className="block transition hover:scale-[1.015]">
            <Poster event={next.event} main={next.main} red={next.red} blue={next.blue} />
          </Link>
        </div>
      </section>

      {/* Next main event */}
      <section>
        <SectionTitle eyebrow={`In ${daysUntil(next.event.date)} days`} title="Next main event" href={`/events/${next.event.id}`} cta="Full card" />
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="card p-6">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
              {[next.red, next.blue].map((b, i) => (
                <Link key={b.id} href={`/boxers/${b.slug}`} className={`flex flex-col items-center gap-2 text-center ${i === 1 ? "order-3" : ""}`}>
                  <Headshot boxer={b} size={104} />
                  <div className="font-display text-2xl font-bold leading-tight">{b.name}</div>
                  <div className="text-xs text-muted">{flag(b.country)} {recordStr(b)} · {b.kos} KO · Elo {Math.round(b.rating)}</div>
                </Link>
              ))}
              <div className="order-2 text-center font-display text-3xl font-extrabold text-gold">VS</div>
            </div>
            <div className="mt-6"><ProbBar a={next.red.name} b={next.blue.name} pA={p.pA} pB={p.pB} pDraw={p.pDraw} /></div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="chip !border-gold/40 !text-gold">✦ {p.confidence}</span>
              <span className="chip">{p.koProb > 0.5 ? "Stoppage likely" : "Distance likely"} · {Math.round(p.koProb * 100)}% KO/TKO</span>
              <Link href={`/compare?a=${next.red.slug}&b=${next.blue.slug}`} className="ml-auto text-ink hover:text-gold">Full matchup breakdown →</Link>
            </div>
          </div>
          <PickEm bouts={pickBouts} />
        </div>
      </section>

      {/* Upcoming strip */}
      <section>
        <SectionTitle eyebrow="Fight calendar" title="Coming up" href="/events" />
        <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-3">
          {ups.slice(1).map((e) => (
            <Link key={e.event.id} href={`/events/${e.event.id}`} className="card-hover w-52 shrink-0">
              <Poster event={e.event} main={e.main} red={e.red} blue={e.blue} />
            </Link>
          ))}
        </div>
      </section>

      {/* Rankings */}
      <section className="grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div>
          <SectionTitle eyebrow="All divisions" title="Pound for pound" href="/rankings" cta="All division rankings" />
          <div className="grid gap-3 sm:grid-cols-2">{p4p.map((b, i) => <BoxerCard key={b.id} b={b} rank={i + 1} />)}</div>
          <Link href="/rankings?sex=female" className="mt-3 inline-block text-sm text-muted transition hover:text-ink">Women’s pound for pound →</Link>
        </div>
        <div>
          <SectionTitle eyebrow="Official names & limits" title="Divisions" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DIVISIONS.map((d) => (
              <Link key={d.name} href={`/rankings/${slugifyDivision(d.name)}`} className="card card-hover px-3 py-2.5">
                <div className="text-sm font-semibold leading-tight">{d.name}</div>
                <div className="text-[11px] text-muted">{d.lb ? `${d.lb} lb` : "200+ lb"}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Results + upset */}
      <section className="grid gap-8 lg:grid-cols-[1.2fr_.8fr]">
        <div>
          <SectionTitle eyebrow="Latest" title="Recent main events" href="/events" />
          <div className="card divide-y divide-line/60">
            {recent.map(({ event, main, red, blue }) => {
              const win = main.winnerId ? (main.winnerId === red.id ? red : blue) : null;
              return (
                <Link key={event.id} href={`/events/${event.id}`} className="flex items-center gap-3 p-3 transition hover:bg-panel2/50">
                  <Headshot boxer={win ?? red} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm"><b>{win ? win.name : "Draw"}</b> <span className="text-muted">{win ? `beat ${win === red ? blue.name : red.name}` : `${red.name} vs ${blue.name}`}</span></div>
                    <div className="text-xs text-muted">{fmtDate(event.date)} · {event.city}</div>
                  </div>
                  <span className="chip tabular">{methodLabel(main.method, main.endRound)}</span>
                </Link>
              );
            })}
          </div>
        </div>
        <div>
          <SectionTitle eyebrow="Analytics" title="Upset of the year" href="/analytics" cta="More analytics" />
          {upset ? (
            <div className="card p-5">
              <div className="text-sm text-muted">{fmtDate(upset.bout.date)} · {upset.bout.eventName}</div>
              <div className="mt-2 font-display text-2xl font-bold leading-tight">
                {w.byId.get(upset.bout.winnerId!)!.name} <span className="text-muted">upset</span> {upset.bout.winnerId === upset.bout.redId ? upset.bout.blueName : upset.bout.redName}
              </div>
              <div className="mt-3 text-sm text-muted">Winner entered rated <b className="text-ink">{Math.round(upset.winnerRating)}</b> against <b className="text-ink">{Math.round(upset.loserRating)}</b> — a {Math.round(upset.gap)}-point underdog.</div>
            </div>
          ) : <div className="card p-5 text-sm text-muted">No upsets recorded yet.</div>}
          <div className="mt-6"><SectionTitle title="Your watchlist" /><WatchlistStrip fighters={watchData} /></div>
        </div>
      </section>
    </div>
  );
}

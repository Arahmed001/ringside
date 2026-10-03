import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorld, recordStr } from "@/lib/world";
import { rankOf } from "@/lib/rankings";
import { similarTo, archetype, ARCH_COLOR } from "@/lib/style";
import { rulesReport } from "@/lib/ai";
import { predict } from "@/lib/predict";
import { divisionInfo, limitLabel, slugifyDivision } from "@/lib/divisions";
import { Headshot } from "@/components/Portrait";
import { Sparkline, Radar, Donut } from "@/components/charts";
import { ScoutingReport } from "@/components/ScoutingReport";
import { WatchButton } from "@/components/Watch";
import { BoutLine, BoxerCard, SectionTitle, Stat } from "@/components/ui";
import { flag, fmtDate, pct } from "@/lib/format";
import { boxerTeam, currentOf, monthsWithCurrentTrainer, ROLE_LABEL } from "@/lib/team";
import { avgRehydration, missCount, weightHistory } from "@/lib/weights";
import { TeamTimeline, type TimelineRow } from "@/components/TeamTimeline";
import { WeightChart } from "@/components/WeightChart";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const b = (await getWorld()).bySlug.get(slug);
  return { title: b ? b.name : "Fighter" };
}

export default async function BoxerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const w = await getWorld();
  const b = w.bySlug.get(slug);
  if (!b) notFound();
  const bouts = w.boutsByBoxer.get(b.id) ?? [];
  const done = bouts.filter((x) => !x.upcoming).slice().reverse();
  const upcoming = bouts.find((x) => x.upcoming);
  const history = w.history.get(b.id) ?? [];
  const rank = rankOf(w, b);
  const div = divisionInfo(b.weightClass)!;
  const a = archetype(b);
  const similar = similarTo(b, w, 4);
  const divBoxers = w.boxers.filter((x) => x.weightClass === b.weightClass && x.bouts >= 5);
  const norm = (v: number, arr: number[]) => { const mn = Math.min(...arr), mx = Math.max(...arr); return mx === mn ? 0.5 : (v - mn) / (mx - mn); };
  const radar = [
    { label: "Power", v: norm(b.koRate, divBoxers.map((x) => x.koRate)) },
    { label: "Winning", v: norm(b.winRate, divBoxers.map((x) => x.winRate)) },
    { label: "Durability", v: 1 - norm(b.bouts ? b.koLosses / b.bouts : 0, divBoxers.map((x) => (x.bouts ? x.koLosses / x.bouts : 0))) },
    { label: "Reach", v: norm(b.reachCm, divBoxers.map((x) => x.reachCm)) },
    { label: "Experience", v: norm(b.bouts, divBoxers.map((x) => x.bouts)) },
    { label: "Rating", v: norm(b.rating, divBoxers.map((x) => x.rating)) },
  ];
  const methods = { KO: 0, Decision: 0 };
  for (const x of done) if (x.winnerId === b.id) { if (x.method === "KO" || x.method === "TKO") methods.KO++; else methods.Decision++; }
  // team history, weigh-ins
  const team = boxerTeam(w, b.id);
  const wHist = weightHistory(w, b.id);
  const rehydration = avgRehydration(w, b.id);
  const misses = missCount(w, b.id);
  const monthsWithTrainer = monthsWithCurrentTrainer(w, b.id);
  const ROLE_COLOR: Record<string, string> = { head_trainer: "#d9b25f", gym: "#4a8cff", manager: "#7ee0b4", promoter: "#c58bff", strength_coach: "#8d8d99" };
  const timelineRows: TimelineRow[] = (["head_trainer", "gym", "manager", "promoter", "strength_coach"] as const)
    .filter((r) => team.get(r)?.length)
    .map((r) => ({
      label: ROLE_LABEL[r].replace(" & conditioning", ""), color: ROLE_COLOR[r],
      segments: team.get(r)!.map((v) => {
        const name = v.person?.name ?? v.org?.name ?? "Unknown";
        const href = v.person ? `/people/${v.person.slug}` : v.org ? `/orgs/${v.org.slug}` : undefined;
        return { from: v.stint.start, to: v.stint.end, label: name, sub: v.record.bouts ? `${v.record.wins}-${v.record.losses}-${v.record.draws}` : undefined, href, current: v.current };
      }),
    }));
  const teamNow = (["head_trainer", "gym", "manager", "promoter"] as const).map((r) => ({ role: r, v: currentOf(team, r) })).filter((x) => x.v);
  const bioAge = b.birthDate ? Math.floor((Date.parse(w.today) - Date.parse(b.birthDate)) / (365.25 * 86400000)) : null;
  let nextBlock = null as React.ReactNode;
  if (upcoming) {
    const oppId = upcoming.redId === b.id ? upcoming.blueId : upcoming.redId;
    const opp = w.byId.get(oppId)!;
    const p = predict(b, opp);
    nextBlock = (
      <Link href={`/compare?a=${b.slug}&b=${opp.slug}`} className="card card-hover mt-6 flex flex-wrap items-center gap-4 p-4">
        <span className="chip !border-gold/40 !text-gold live">Next fight</span>
        <span className="text-sm">{fmtDate(upcoming.date)} vs <b>{opp.name}</b> <span className="text-muted">({recordStr(opp)})</span></span>
        <span className="ml-auto text-sm">Model: <b className="text-gold">{Math.round(p.pA * 100)}%</b> win</span>
      </Link>
    );
  }

  return (
    <div className="space-y-10">
      <section className="rise grid gap-8 md:grid-cols-[auto_1fr]">
        <div className="mx-auto md:mx-0">
          <Headshot boxer={b} size={200} className="shadow-2xl shadow-black/60" />
          {b.photoCredit && (
            <p className="mt-1.5 max-w-[200px] text-[10px] leading-snug text-muted">
              Photo: <a href={b.photoCredit.pageUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-ink">{b.photoCredit.text}</a>
              {" · "}{b.photoCredit.source}
            </p>
          )}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/rankings/${slugifyDivision(b.weightClass)}`} className="chip transition hover:text-ink">{b.weightClass}</Link>
            {rank && <Link href={`/rankings/${slugifyDivision(b.weightClass)}`} className="chip !border-gold/50 !text-gold">#{rank} {b.weightClass}</Link>}
            <span className="chip" style={{ borderColor: ARCH_COLOR[a] + "55", color: ARCH_COLOR[a] }}>{a}</span>
            {!b.active && <span className="chip">Retired</span>}
            <span className="ml-auto"><WatchButton slug={b.slug} /></span>
          </div>
          <h1 className="mt-3 font-display text-6xl font-extrabold uppercase leading-[.95] sm:text-7xl">{b.name}</h1>
          {b.nickname && <div className="mt-1 font-serif text-3xl italic text-gold">“{b.nickname}”</div>}
          <div className="mt-2 text-muted">{flag(b.country)} {b.country} · Age {b.age} · {b.stance} · Pro since {b.turnedPro}</div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Record" value={recordStr(b)} sub={`${b.bouts} fights`} />
            <Stat label="Knockouts" value={b.kos} sub={`${pct(b.koRate)} of wins`} />
            <Stat label="Rating" value={Math.round(b.rating)} sub="Elo-style" />
            <Stat label="Reach" value={`${b.reachCm}cm`} sub={`${b.heightCm}cm tall · ${limitLabel(div)}`} />
          </div>
          {nextBlock}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <div className="card p-5">
          <div className="eyebrow mb-3">Profile</div>
          <dl className="space-y-2.5 text-sm">
            {([
              ["Born", b.birthDate ? `${fmtDate(b.birthDate)}${bioAge !== null ? ` (${bioAge})` : ""}${b.birthPlace ? ` · ${b.birthPlace}` : ""}` : String(b.birthYear)],
              ["Lives in", b.residence],
              ["Also known as", b.aliases.length ? b.aliases.join(", ") : null],
              ["Pro debut", b.debutDate ? fmtDate(b.debutDate) : String(b.turnedPro)],
              ["Retired", b.retiredDate ? fmtDate(b.retiredDate) : null],
              ["Height / reach", `${b.heightCm} cm / ${b.reachCm} cm`],
            ] as [string, string | null][]).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="text-right">{v}</dd></div>
            ))}
            {(b.wikidataId || b.boxrecId) && (
              <div className="flex justify-between gap-4 border-t border-line/60 pt-2.5 text-xs"><dt className="text-muted">Identifiers</dt><dd className="text-right text-muted">{b.wikidataId && <a href={`https://www.wikidata.org/wiki/${b.wikidataId}`} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-ink">Wikidata {b.wikidataId}</a>}{b.wikidataId && b.boxrecId ? " · " : ""}{b.boxrecId && `BoxRec ID ${b.boxrecId}`}</dd></div>
            )}
          </dl>
        </div>
        <div className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="eyebrow">Corner &amp; camp</div>{monthsWithTrainer !== null && <span className={`chip ${monthsWithTrainer < 6 ? "!border-red/40 !text-red" : ""}`}>{monthsWithTrainer < 6 ? "New trainer · " : ""}{Math.round(monthsWithTrainer)} months with current trainer</span>}</div>
          {teamNow.length > 0 && (
            <div className="mb-5 grid gap-2 sm:grid-cols-2">
              {teamNow.map(({ role, v }) => {
                const name = v!.person?.name ?? v!.org?.name;
                const href = v!.person ? `/people/${v!.person.slug}` : v!.org ? `/orgs/${v!.org.slug}` : "#";
                return <Link key={role} href={href} className="rounded-xl bg-panel2 px-3 py-2 transition hover:bg-panel2/70"><div className="text-[10px] uppercase tracking-widest text-muted">{ROLE_LABEL[role]}</div><div className="text-sm font-semibold">{name}</div></Link>;
              })}
            </div>
          )}
          {timelineRows.length > 0 ? <TeamTimeline rows={timelineRows} today={w.today} /> : <p className="text-sm text-muted">No team history on record yet.</p>}
        </div>
      </section>

      {wHist.length >= 2 && (
        <section className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="eyebrow">Weigh-in history</div>
            <div className="flex gap-2 text-xs">
              {rehydration !== null && <span className="chip">Rehydrates +{rehydration.toFixed(1)} lb</span>}
              <span className={`chip ${misses ? "!border-red/40 !text-red" : ""}`}>{misses ? `${misses} missed weight${misses > 1 ? "s" : ""}` : "Never missed weight"}</span>
              <Link href="/weights" className="chip hover:text-ink">League weigh-in stats →</Link>
            </div>
          </div>
          <WeightChart points={wHist} />
        </section>
      )}

      <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="card p-5">
          <div className="eyebrow mb-1">AI scouting report</div>
          <ScoutingReport slug={b.slug} initial={rulesReport(b, w)} />
        </div>
        <div className="card flex items-center justify-center p-5"><Radar axes={radar} /></div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="card p-5">
          <div className="eyebrow mb-3">Rating history</div>
          <Sparkline data={history.map((h) => h.rating)} labels={history.length ? [fmtDate(history[0].date, { month: "short", year: "numeric" }), fmtDate(history[history.length - 1].date, { month: "short", year: "numeric" })] : undefined} />
        </div>
        <div className="card p-5">
          <div className="eyebrow mb-3">How he wins</div>
          {b.wins ? <Donut parts={[{ label: "Knockouts", value: methods.KO, color: "#e5322d" }, { label: "Decisions", value: methods.Decision, color: "#d9b25f" }]} center={{ big: String(b.wins), small: "WINS" }} /> : <p className="text-sm text-muted">No wins yet.</p>}
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="Style similarity" title="Fighters like him" href="/map" cta="Style map" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {similar.map((s) => (
            <div key={s.boxer.id} className="relative"><BoxerCard b={s.boxer} /><span className="chip absolute right-3 top-3 !border-gold/40 !text-gold">{s.match}% match</span></div>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="Fight record" title={`${done.length} bouts`} />
        <div className="card overflow-x-auto p-4">
          <table className="w-full"><tbody>{(upcoming ? [upcoming, ...done] : done).map((x) => <BoutLine key={x.id} bout={x} focusId={b.id} />)}</tbody></table>
        </div>
      </section>
    </div>
  );
}

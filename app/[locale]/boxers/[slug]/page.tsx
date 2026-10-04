import { ScrollRegion } from "@/components/ScrollRegion";
import Link from "@/components/L";
import { localePath } from "@/lib/i18n/config";
import { abs } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";
import { CareerMoneyCard } from "@/components/Money";
import { TitlesCard, NextFightCard } from "@/components/TitlesCard";
import { BoxerRecords } from "@/components/Awards";
import { notFound } from "next/navigation";
import { careerView, getWorld, recordStr } from "@/lib/world";
import { countrySlug } from "@/lib/countries";
import { getDb } from "@/lib/db";
import { isKnown, orDash, wikipediaUrl } from "@/lib/facts";
import { boxerPageNotes } from "@/lib/accounts/corrections";
import { CorrectionNotes, type NoteRow } from "@/components/CorrectionNotes";
import { rankOf } from "@/lib/rankings";
import { similarTo, archetype, ARCH_COLOR } from "@/lib/style";
import { rulesReport } from "@/lib/ai";
import { predict } from "@/lib/predict";
import { divisionInfo, divisionLabel, limitLabel, slugifyDivision } from "@/lib/divisions";
import { Headshot } from "@/components/Portrait";
import { Sparkline, Radar, Donut } from "@/components/charts";
import { ScoutingReport } from "@/components/ScoutingReport";
import { WatchButton } from "@/components/Watch";
import { BoutLine, BoxerCard, ResultPill, SectionTitle, Stat } from "@/components/ui";
import { form as formOf, goingIn, resultFor, since, type Since } from "@/lib/glance";
import { highlightsOf } from "@/lib/highlights";
import { countryName, flag, fmtDate, fmtPartialDate, pct } from "@/lib/format";
import { msg } from "@/lib/i18n/t";
import { countsInRecord, isDecision, isStoppage } from "@/lib/methods";
import { EDIT_SOURCE } from "@/lib/accounts/edit-source";
import { boxerTeam, currentOf, monthsWithCurrentTrainer, ROLE_LABEL } from "@/lib/team";
import { avgRehydration, missCount, weightHistory } from "@/lib/weights";
import { TeamTimeline, type TimelineRow } from "@/components/TeamTimeline";
import { WeightChart } from "@/components/WeightChart";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string; slug: string }> }) =>
  metaFor(params, async ({ slug }, t) => {
    const b = (await getWorld()).bySlug.get(slug);
    if (!b) return { path: `/boxers/${slug}`, title: t("Fighter"), description: t("Fighter profile on Ringside: record, ratings, team and fight history.") };
    return {
      path: `/boxers/${b.slug}`, type: "profile" as const, title: t.name(b.name),
      description: t("{name}: {division} boxer from {country}. Record {record} with {kos} KOs and a {rating} Elo rating. Fight history, team, weigh-ins and scouting report.", {
        name: t.name(b.name), division: divisionLabel(b.weightClass, b.sex, t), country: countryName(b.country, t.locale), record: recordStr(b), kos: b.kos, rating: Math.round(b.rating),
      }),
    };
  });

export default async function BoxerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getT();
  const w = await getWorld();
  const b = w.bySlug.get(slug);
  if (!b) notFound();
  const career = careerView(b);
  const bouts = w.boutsByBoxer.get(b.id) ?? [];
  const done = bouts.filter((x) => !x.upcoming).slice().reverse(); // includes cancelled bouts, shown with a chip
  const completed = done.filter((x) => countsInRecord(x.method));
  const upcoming = bouts.find((x) => x.upcoming);
  // the facts a fan looks for first: how the last five went, how long ago the last fight was, and each opponent as they were going into the fight
  const recent = formOf(bouts, b.id);
  const lastDone = [...bouts].reverse().find((x) => resultFor(x, b.id) !== null);
  const ago = lastDone ? since(w.today, lastDone.date) : null;
  const lastFought = (x: Since) => x.n === 0 && x.unit === "days" ? t("Last fought today") : x.unit === "days" ? t.n(x.n, "Last fought {n} day ago", "Last fought {n} days ago") : x.unit === "months" ? t.n(x.n, "Last fought {n} month ago", "Last fought {n} months ago") : t.n(x.n, "Last fought {n} year ago", "Last fought {n} years ago");
  const highlights = highlightsOf(bouts, b.id, w.boutPre);
  const hl = (id: number) => { const x = w.boutById.get(id); return x ? fmtDate(x.date, { month: "short", year: "numeric" }, t.locale) : ""; };
  const hasHighlights = !!(highlights.bestWin || highlights.biggestUpset || highlights.longestStreak);
  const opponentThen = new Map<number, React.ReactNode>();
  for (const x of done) {
    if (resultFor(x, b.id) === null) continue;
    const oppId = x.redId === b.id ? x.blueId : x.redId;
    const opp = w.byId.get(oppId);
    if (!opp) continue;
    const pre = w.boutPre.get(x.id);
    const g = goingIn(w.boutsByBoxer.get(oppId) ?? [], x.id, oppId, Math.round((oppId === x.redId ? pre?.red : pre?.blue) ?? 1500), careerView(opp).source === "loaded");
    opponentThen.set(x.id, g.record ? t.rich("then <r>{record}</r>, rated {rating}", { record: g.record, rating: g.rating, r: (c) => <bdi dir="ltr">{c}</bdi> }) : g.debut ? t("then on debut, rated {rating}", { rating: g.rating }) : t("then rated {rating}", { rating: g.rating }));
  }
  const history = w.history.get(b.id) ?? [];
  const rank = rankOf(w, b);
  const div = divisionInfo(b.weightClass)!;
  const a = archetype(b);
  const similar = similarTo(b, w, 4);
  const divBoxers = w.boxers.filter((x) => x.sex === b.sex && x.weightClass === b.weightClass && x.bouts >= 5);
  const norm = (v: number, arr: number[]) => { if (!arr.length) return 0.5; const mn = Math.min(...arr), mx = Math.max(...arr); return mx === mn ? 0.5 : (v - mn) / (mx - mn); };
  const radar = [
    { label: t("Power"), v: norm(b.koRate, divBoxers.map((x) => x.koRate)) },
    { label: t("Winning"), v: norm(b.winRate, divBoxers.map((x) => x.winRate)) },
    { label: t("Durability"), v: 1 - norm(b.bouts ? b.koLosses / b.bouts : 0, divBoxers.map((x) => (x.bouts ? x.koLosses / x.bouts : 0))) },
    ...(isKnown(b.reachCm) ? [{ label: t("Reach"), v: norm(b.reachCm, divBoxers.map((x) => x.reachCm).filter(isKnown)) }] : []), // an unknown reach is left off the chart, not drawn as short
    { label: t("Experience"), v: norm(b.bouts, divBoxers.map((x) => x.bouts)) },
    { label: t("Rating"), v: norm(b.rating, divBoxers.map((x) => x.rating)) },
  ];
  const methods = { KO: 0, Decision: 0, Other: 0 };
  for (const x of completed) if (x.winnerId === b.id) { if (isStoppage(x.method)) methods.KO++; else if (isDecision(x.method)) methods.Decision++; else methods.Other++; }
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
      label: r === "strength_coach" ? t("Strength") : t(ROLE_LABEL[r]), color: ROLE_COLOR[r],
      segments: team.get(r)!.map((v) => {
        const name = v.person ? t.name(v.person.name) : v.org ? t.name(v.org.name) : t("Unknown");
        const href = v.person ? `/people/${v.person.slug}` : v.org ? `/orgs/${v.org.slug}` : undefined;
        return { from: v.stint.start, to: v.stint.end, label: name, sub: v.record.bouts ? `${v.record.wins}-${v.record.losses}-${v.record.draws}` : undefined, href, current: v.current };
      }),
    }));
  const noted = boxerPageNotes(await getDb(), b.id);
  const noteRows: NoteRow[] = [
    ...noted.boxer,
    ...noted.bouts.map((n) => { const x = w.boutById.get(n.boutId), r = x && w.byId.get(x.redId), u = x && w.byId.get(x.blueId); return { ...n, about: { href: `/bouts/${n.boutId}`, label: r && u ? t("{a} vs {b}", { a: t.name(r.name), b: t.name(u.name) }) : t("Fight") }, names: (r && u ? [t.name(r.name), t.name(u.name)] : undefined) as [string, string] | undefined }; }),
  ];
  const community = (w.stintsByBoxer.get(b.id) ?? []).filter((x) => x.source === EDIT_SOURCE && x.personId).map((x) => ({ id: x.id, person: w.people.get(x.personId!)?.name ?? "", role: x.role, start: x.start, sourceUrl: x.sourceUrl ?? null })).filter((x) => x.person);
  const teamNow = (["head_trainer", "gym", "manager", "promoter"] as const).map((r) => ({ role: r, v: currentOf(team, r) })).filter((x) => x.v);
  const honours = w.honoursByBoxer.get(b.id) ?? [];
  const reigns = w.reignsByBoxer.get(b.id) ?? [];
  const REIGN_STATUS: Record<string, string> = {
  "super champion": msg("Super champion"), "unified champion": msg("Unified champion"), "undisputed champion": msg("Undisputed champion"),
  "regular champion": msg("Regular champion"), "interim champion": msg("Interim champion"),
};
const HONOURS_SHOWN = 8;
  const bioAge = b.birthDate ? Math.floor((Date.parse(w.today) - Date.parse(b.birthDate)) / (365.25 * 86400000)) : null;
  let nextBlock = null as React.ReactNode;
  if (upcoming) {
    const oppId = upcoming.redId === b.id ? upcoming.blueId : upcoming.redId;
    const opp = w.byId.get(oppId)!;
    const p = predict(b, opp, t);
    nextBlock = (
      <Link href={`/compare?a=${b.slug}&b=${opp.slug}`} className="card card-hover mt-6 flex flex-wrap items-center gap-4 p-4">
        <span className="chip !border-gold/40 !text-gold live">{t("Next fight")}</span>
        <span className="text-sm">{t.rich("{date} vs <b>{name}</b>", { date: fmtDate(upcoming.date, undefined, t.locale), name: t.name(opp.name), b: (c) => <b>{c}</b> })} <span className="text-muted">(<bdi dir="ltr">{recordStr(opp)}</bdi>)</span></span>
        <span className="ms-auto text-sm">{t.rich("Model: <b>{p}%</b> win", { p: Math.round(p.pA * 100), b: (c) => <b className="text-gold">{c}</b> })}</span>
      </Link>
    );
  }

  return (
    <div className="space-y-10">
      <JsonLd data={{
        "@type": "Person", name: t.name(b.name), ...(t.name(b.name) !== b.name ? { alternateName: [b.name] } : {}), jobTitle: "Professional boxer",
        nationality: { "@type": "Country", name: b.country }, ...(b.birthDate ? { birthDate: b.birthDate } : {}), ...(b.photoUrl ? { image: b.photoUrl } : {}),
        ...(isKnown(b.heightCm) ? { height: { "@type": "QuantitativeValue", value: b.heightCm, unitCode: "CMT" } } : {}), url: abs(localePath(t.locale, `/boxers/${b.slug}`)), inLanguage: t.locale,
        ...(b.wikidataId ? { sameAs: [`https://www.wikidata.org/wiki/${b.wikidataId}`] } : {}),
      }} />
      <section className="rise grid gap-8 md:grid-cols-[auto_1fr]">
        <div className="mx-auto md:mx-0">
          <Headshot boxer={b} size={200} className="shadow-2xl shadow-black/60" />
          {b.photoCredit && (
            <p className="mt-1.5 max-w-[200px] text-xs leading-snug text-muted">
              {t("Photo:")} <a href={b.photoCredit.pageUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-ink">{b.photoCredit.text}</a>
              {" · "}{b.photoCredit.source}
            </p>
          )}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/rankings/${slugifyDivision(b.weightClass)}${b.sex === "female" ? "?sex=female" : ""}`} className="chip transition hover:text-ink">{divisionLabel(b.weightClass, b.sex, t)}</Link>
            {rank && <Link href={`/rankings/${slugifyDivision(b.weightClass)}${b.sex === "female" ? "?sex=female" : ""}`} className="chip !border-gold/50 !text-gold">{t("#{rank} {division}", { rank, division: divisionLabel(b.weightClass, b.sex, t) })}</Link>}
            <span className="chip" style={{ borderColor: ARCH_COLOR[a] + "55", color: ARCH_COLOR[a] }}>{t(a)}</span>
            {!b.active && <span className="chip">{t("Retired")}</span>}
            <span className="ms-auto"><WatchButton slug={b.slug} /></span>
          </div>
          <h1 className="mt-3 font-display text-6xl font-extrabold uppercase leading-[.95] sm:text-7xl">{t.name(b.name)}</h1>
          {b.nickname && <div className="mt-1 font-serif text-3xl italic text-gold">“{t.name(b.nickname)}”</div>}
          <div className="mt-2 text-muted">{flag(b.country)} <Link href={`/countries/${countrySlug(b.country)}`} className="hover:text-ink">{countryName(b.country, t.locale)}</Link>{[b.age !== null ? t("Age {age}", { age: b.age }) : null, b.stance ? t(b.stance) : null, b.turnedPro !== null ? t("Pro since {year}", { year: b.turnedPro }) : null].filter(Boolean).map((x) => ` · ${x}`).join("")}</div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t("Record")} value={recordStr(b)} sub={career.source === "supplier" ? t.n(career.total, "{n} fight in all", "{n} fights in all") : t.n(b.bouts, "{n} fight", "{n} fights")} />
            <Stat label={t("Knockouts")} value={b.kos} sub={t("{p} of wins", { p: pct(b.koRate) })} />
            <Stat label={t("Rating")} value={Math.round(b.rating)} sub={t("Elo-style")} />
            <Stat label={t("Reach")} value={orDash(b.reachCm, (n) => t("{n}cm", { n }))} sub={isKnown(b.heightCm) ? t("{h}cm tall · {limit}", { h: b.heightCm, limit: limitLabel(div, t) }) : limitLabel(div, t)} />
          </div>
          {recent.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="flex items-center gap-1.5">
                <span className="me-1 text-muted">{t.n(recent.length, "Last fight", "Last {n} fights")}</span>
                {recent.map((r, i) => <ResultPill key={i} r={r} />)}
              </span>
              {ago && <span className="text-muted">{lastFought(ago)}</span>}
            </div>
          )}
          {career.source === "supplier" && (
            <p className="mt-3 max-w-2xl text-xs leading-snug text-muted">
              {t("The record is the career total from the data supplier. Ringside holds {held} of those {total} fights, so the fight list, knockouts, rating and rates on this page are built from those {held} only.", { held: career.held, total: career.total })}
            </p>
          )}
          {nextBlock}
        </div>
      </section>

      {hasHighlights && (
        <section>
          <SectionTitle eyebrow={t("Career highlights")} title={t("The best of the fights we hold")} />
          <div className="grid gap-3 md:grid-cols-3">
            {highlights.bestWin && (() => { const o = w.byId.get(highlights.bestWin!.opponentId); return o ? (
              <Link href={`/bouts/${highlights.bestWin.boutId}`} className="card card-hover p-4">
                <div className="eyebrow mb-1">{t("Best win")}</div>
                <div className="font-display text-xl font-bold leading-tight">{t.name(o.name)}</div>
                <div className="text-xs text-muted">{t("Rated {rating} going in", { rating: highlights.bestWin.opponentRating })} · {hl(highlights.bestWin.boutId)}</div>
              </Link>) : null; })()}
            {highlights.biggestUpset && (() => { const o = w.byId.get(highlights.biggestUpset!.opponentId); return o ? (
              <Link href={`/bouts/${highlights.biggestUpset.boutId}`} className="card card-hover p-4">
                <div className="eyebrow mb-1">{t("Biggest upset")}</div>
                <div className="font-display text-xl font-bold leading-tight">{t.name(o.name)}</div>
                <div className="text-xs text-muted">{t("Rated {n} points higher going in", { n: highlights.biggestUpset.gap })} · {hl(highlights.biggestUpset.boutId)}</div>
              </Link>) : null; })()}
            {highlights.longestStreak && (
              <div className="card p-4">
                <div className="eyebrow mb-1">{t("Longest winning run")}</div>
                <div className="font-display text-xl font-bold leading-tight">{t.n(highlights.longestStreak.wins, "{n} straight win", "{n} straight wins")}</div>
                <div className="text-xs text-muted">{highlights.longestStreak.endedBoutId ? t("Ended in {date}", { date: hl(highlights.longestStreak.endedBoutId) }) : t("Still going")}</div>
              </div>
            )}
          </div>
          {career.source === "supplier" && <p className="mt-2 text-xs text-muted">{t("Worked out from the {held} fights Ringside holds, not the whole career.", { held: career.held })}</p>}
        </section>
      )}

      <section className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <div className="card p-5">
          <div className="eyebrow mb-3">{t("Profile")}</div>
          <dl className="space-y-2.5 text-sm">
            {([
              [t("Born"), b.birthDate ? `${fmtDate(b.birthDate, undefined, t.locale)}${bioAge !== null ? ` (${bioAge})` : ""}${b.birthPlace ? ` · ${t.name(b.birthPlace)}` : ""}` : b.birthYear !== null ? String(b.birthYear) : null],
              [t("Lives in"), b.residence ? t.name(b.residence) : null],
              [t("Also known as"), b.aliases.length ? b.aliases.map((x) => t.name(x)).join(", ") : null],
              [t("Pro debut"), b.debutDate ? fmtDate(b.debutDate, undefined, t.locale) : b.turnedPro !== null ? String(b.turnedPro) : null],
              [t("Retired"), b.retiredDate ? fmtDate(b.retiredDate, undefined, t.locale) : null],
              [t("Height / reach"), b.heightCm === null && b.reachCm === null ? null : `${orDash(b.heightCm, (n) => t("{n} cm", { n }))} / ${orDash(b.reachCm, (n) => t("{n} cm", { n }))}`],
            ] as [string, string | null][]).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="text-end">{v}</dd></div>
            ))}
            {(b.wikidataId || b.boxrecId || b.ibhofId || b.olympediaId || b.wikipediaTitle) && (
              <div className="flex justify-between gap-4 border-t border-line/60 pt-2.5 text-xs"><dt className="text-muted">{t("Identifiers")}</dt><dd className="text-end text-muted">{
                [
                  b.wikidataId && <a key="wd" href={`https://www.wikidata.org/wiki/${b.wikidataId}`} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-ink">{t("Wikidata {id}", { id: b.wikidataId })}</a>,
                  b.wikipediaTitle && <a key="wp" href={wikipediaUrl(b.wikipediaTitle)} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-ink">{t("Wikipedia")}</a>,
                  b.ibhofId && <a key="hof" href={`http://www.ibhof.com/pages/about/inductees/${b.ibhofId}.html`} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-ink">{t("Hall of Fame page")}</a>,
                  b.olympediaId && <a key="oly" href={`https://www.olympedia.org/athletes/${b.olympediaId}`} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-ink">{t("Olympedia")}</a>,
                  b.boxrecId && <span key="br">{t("BoxRec ID {id}", { id: b.boxrecId })}</span>,
                ].filter(Boolean).flatMap((el, i) => (i ? [" · ", el] : [el]))
              }</dd></div>
            )}
          </dl>
          <CorrectionNotes rows={noteRows} />
          <p className="mt-3 text-xs text-muted"><Link href={`/report?boxer=${b.slug}`} className="underline decoration-dotted hover:text-ink">{t("Report a mistake on this profile")}</Link></p>
          <BoxerRecords w={w} boxerId={b.id} />
          {honours.length > 0 && (
            <div className="mt-4 border-t border-line/60 pt-3">
              <div className="eyebrow mb-2">{t("Honours")}</div>
              <ul className="flex flex-wrap gap-1.5">
                {honours.slice(0, HONOURS_SHOWN).map((h) => (
                  <li key={`${h.kind}|${h.label}|${h.year}`} className={`chip ${h.kind === "title" ? "" : "!border-gold/50 !text-gold"}`}>{t.name(h.label)}{h.year ? ` · ${h.year}` : ""}</li>
                ))}
                {honours.length > HONOURS_SHOWN && <li className="chip">{t("+{n} more", { n: honours.length - HONOURS_SHOWN })}</li>}
              </ul>
              <p className="mt-2 text-xs text-muted">{t("From Wikidata (CC0).")}</p>
            </div>
          )}
          {reigns.length > 0 && (
            <div className="mt-4 border-t border-line/60 pt-3">
              <div className="eyebrow mb-2">{t("Title history")}</div>
              <ul className="space-y-1 text-sm">
                {reigns.map((r) => (
                  <li key={`${r.source}|${r.division}|${r.category}|${r.start}`}>
                    <span className="font-semibold">{t("{org} {division} champion", { org: r.org, division: divisionLabel(r.division, b.sex, t) })}</span>
                    {r.status && REIGN_STATUS[r.status.toLowerCase()] && <span className="chip ms-2">{t(REIGN_STATUS[r.status.toLowerCase()])}</span>}
                    <span className="text-muted"> · {r.start ? fmtPartialDate(r.start, t.locale) : "?"} – {r.current ? t("present") : r.end ? fmtPartialDate(r.end, t.locale) : "?"}{r.defences !== null ? ` · ${t.n(r.defences, "{n} defence", "{n} defences")}` : ""}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">
                {t("From Wikipedia (CC BY-SA 4.0), a reference and not an official record:")}{" "}
                {[...new Set(reigns.map((r) => r.source))].map((src, i) => (
                  <span key={src}>{i ? " · " : ""}<a href={`https://en.wikipedia.org/wiki/${src}`} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-ink">{src.replace(/_/g, " ")}</a></span>
                ))}
              </p>
            </div>
          )}
        </div>
        <div className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="eyebrow">{t("Corner & camp")}</div>{monthsWithTrainer !== null && <span className={`chip ${monthsWithTrainer < 6 ? "!border-red/40 !text-red-ink" : ""}`}>{monthsWithTrainer < 6 ? t.n(Math.round(monthsWithTrainer), "New trainer · {n} month with current trainer", "New trainer · {n} months with current trainer") : t.n(Math.round(monthsWithTrainer), "{n} month with current trainer", "{n} months with current trainer")}</span>}</div>
          {teamNow.length > 0 && (
            <div className="mb-5 grid gap-2 sm:grid-cols-2">
              {teamNow.map(({ role, v }) => {
                const name = t.name(v!.person?.name ?? v!.org?.name ?? "");
                const href = v!.person ? `/people/${v!.person.slug}` : v!.org ? `/orgs/${v!.org.slug}` : "#";
                return <Link key={role} href={href} className="rounded-xl bg-panel2 px-3 py-2 transition hover:bg-panel2/70"><div className="text-xs uppercase tracking-widest text-muted">{t(ROLE_LABEL[role])}</div><div className="text-sm font-semibold">{name}</div></Link>;
              })}
            </div>
          )}
          {timelineRows.length > 0 ? <TeamTimeline rows={timelineRows} today={w.today} /> : <p className="text-sm text-muted">{t("No team history on record yet.")}</p>}
          {community.length > 0 && (
            <div className="mt-4 text-xs text-muted">
              <div className="mb-1 uppercase tracking-widest">{t("Community edits, checked by an editor")}</div>
              <ul className="space-y-1">
                {community.map((c) => (
                  <li key={c.id}>{t("{person}, {role}, from {from}", { person: t.name(c.person), role: t(ROLE_LABEL[c.role]), from: c.start ?? "?" })}{c.sourceUrl && /^https?:\/\//.test(c.sourceUrl) && <> · <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer nofollow ugc" className="underline decoration-dotted hover:text-ink">{t("source")}</a></>}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-xs text-muted"><Link href={`/contribute?boxer=${b.slug}`} className="underline decoration-dotted hover:text-ink">{t("Suggest an edit to this team history")}</Link></p>
        </div>
      </section>

      {wHist.length >= 2 && (
        <section className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="eyebrow">{t("Weigh-in history")}</div>
            <div className="flex gap-2 text-xs">
              {rehydration !== null && <span className="chip">{t("Rehydrates +{n} lb", { n: rehydration.toFixed(1) })}</span>}
              <span className={`chip ${misses ? "!border-red/40 !text-red-ink" : ""}`}>{misses ? t.n(misses, "{n} missed weight", "{n} missed weights") : t("Never missed weight")}</span>
              <Link href="/weights" className="chip hover:text-ink">{t("League weigh-in stats")} <span className="inline-block rtl:rotate-180">→</span></Link>
            </div>
          </div>
          <WeightChart points={wHist} />
        </section>
      )}

      <section className="grid gap-5 lg:grid-cols-2"><TitlesCard w={w} boxer={b} /><NextFightCard w={w} boxer={b} /></section>

      <CareerMoneyCard w={w} boxer={b} />

      <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="card p-5">
          <div className="eyebrow mb-1">{t("AI scouting report")}</div>
          <ScoutingReport slug={b.slug} initial={rulesReport(b, w, t)} />
        </div>
        <div className="card flex items-center justify-center p-5"><Radar axes={radar} /></div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="card p-5">
          <div className="eyebrow mb-3">{t("Rating history")}</div>
          <Sparkline data={history.map((h) => h.rating)} labels={history.length ? [fmtDate(history[0].date, { month: "short", year: "numeric" }, t.locale), fmtDate(history[history.length - 1].date, { month: "short", year: "numeric" }, t.locale)] : undefined} />
        </div>
        <div className="card p-5">
          <div className="eyebrow mb-3">{b.sex === "female" ? t("How she wins") : t("How he wins")}</div>
          {b.wins ? <Donut parts={[{ label: t("Knockouts"), value: methods.KO, color: "#e5322d" }, { label: t("Decisions"), value: methods.Decision, color: "#d9b25f" }, ...(methods.Other ? [{ label: t("Disqualification"), value: methods.Other, color: "#8d8d99" }] : [])]} center={{ big: String(b.wins), small: t("WINS") }} /> : <p className="text-sm text-muted">{t("No wins yet.")}</p>}
        </div>
      </section>

      <section>
        <SectionTitle eyebrow={t("Style similarity")} title={b.sex === "female" ? t("Fighters like her") : t("Fighters like him")} href="/map" cta={t("Style map")} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {similar.map((s) => (
            <BoxerCard key={s.boxer.id} b={s.boxer} badge={t("{n}% match", { n: s.match })} />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle eyebrow={t("Fight record")} title={t.n(completed.length, "{n} bout", "{n} bouts")} />
        <ScrollRegion className="card p-4" label={t("Fight record")}>
          <table className="w-full" aria-label={t("Fight record")}><tbody>{(upcoming ? [upcoming, ...done] : done).map((x) => <BoutLine key={x.id} bout={x} focusId={b.id} context={opponentThen.get(x.id)} />)}</tbody></table>
        </ScrollRegion>
      </section>
    </div>
  );
}

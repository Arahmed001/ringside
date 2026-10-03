import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { askResultProblems, badNumbers, miniFeed } from "./helpers";
import { tEn, type Names } from "../lib/i18n/t";
import type { FeedData } from "../lib/feed";
import type { ArgSpec, ToolResult } from "../lib/ask/types";

/**
 * A league the real world can be in (the first load, the gap between seasons) rather than the full demo. `league("empty")` has nobody in it;
 * `league("sparse")` has one finished card and nothing upcoming. Loads it through the file provider and returns the world.
 */
export async function league(kind: "empty" | "sparse") {
  const f = miniFeed();
  const feed: FeedData = kind === "empty" ? { ...f, boxers: [], events: [], bouts: [], people: [], orgs: [], stints: [], weighIns: [], officials: [], scorecards: [], corners: [], punches: [] } : f;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ringside-${kind}-`));
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  const w = await (await import("../lib/world")).getWorld();
  return { w, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;

/** Calls every aggregate that takes only the world (and a few that also take a language) and reports any that throw or return a NaN. */
export async function sweepAggregates(w: World): Promise<string[]> {
  const bad: string[] = [];
  const m = async (p: string) => (await import(p)) as Record<string, (...a: unknown[]) => unknown>;
  const [analytics, rankings, events, score, lineage, money, officials, style, upsets, records, accountability, matchmaking, weights, trainer, sitemap, recap, night] = await Promise.all([
    "../lib/analytics", "../lib/rankings", "../lib/events", "../lib/fight-score", "../lib/lineage", "../lib/money", "../lib/officials", "../lib/style", "../lib/upsets", "../lib/records",
    "../lib/accountability", "../lib/matchmaking", "../lib/weights", "../lib/trainer-impact", "../lib/sitemap", "../lib/recap", "../lib/night",
  ].map(m));
  const calls: [string, () => unknown][] = [
    ...["overview", "byWeightClass", "methodSplit", "boutsPerYear", "finishRoundHistogram", "finishHeat", "countryLeaders", "stanceEdge", "reachEdge", "longestStreaks"].map((n): [string, () => unknown] => [`analytics.${n}`, () => analytics[n](w)]),
    ["analytics.biggestUpsets", () => analytics.biggestUpsets(w, 5)],
    ["rankings.pound4pound", () => rankings.pound4pound(w, 10)], ["rankings.pound4pound(women)", () => rankings.pound4pound(w, 10, "female")],
    ["events.upcomingEvents", () => events.upcomingEvents(w)], ["events.recentEvents", () => events.recentEvents(w, 5)],
    ["fight-score.fightYears", () => score.fightYears(w)], ["fight-score.featuredYear", () => score.featuredYear(w)], ["fight-score.fightOfTheYear", () => score.fightOfTheYear(w)],
    ["lineage.belts", () => lineage.belts(w)],
    ...["topGates", "topPpv", "topGross", "topPurses", "topEarners", "broadcasterTable", "revenueByYear", "moneyCoverage"].map((n): [string, () => unknown] => [`money.${n}`, () => money[n](w)]),
    ["officials.judgeStats", () => officials.judgeStats(w)], ["officials.refereeStats", () => officials.refereeStats(w)], ["officials.scoringDisputes", () => officials.scoringDisputes(w)],
    ["style.styleMap", () => style.styleMap(w)], ["style.styleMapSample", () => style.styleMapSample(w)],
    ["upsets.upsetWatch", () => upsets.upsetWatch(w, tEn)], ["upsets.upsetRecord", () => upsets.upsetRecord(w)], ["upsets.signalLift", () => upsets.signalLift(w)], ["upsets.recentShocks", () => upsets.recentShocks(w)],
    ["records.dataSpan", () => records.dataSpan(w)],
    ["accountability.calls", () => accountability.calls(w)], ["accountability.record", () => accountability.record(w)],
    ["matchmaking.fightsToMake", () => matchmaking.fightsToMake(w, 8, tEn)],
    ["weights.divisionWeights", () => weights.divisionWeights(w)], ["weights.fightNightEdge", () => weights.fightNightEdge(w)], ["weights.missedWeights", () => weights.missedWeights(w)],
    ["trainer-impact.trainerImpact", () => trainer.trainerImpact(w)],
    ["sitemap.sitemapPaths", () => sitemap.sitemapPaths(w)], ["sitemap.sitemapCount", () => sitemap.sitemapCount(w)],
  ];
  // per-card, per-bout and per-fighter views: every one the league has
  const [predict, team, lineageMod, moneyMod] = await Promise.all(["../lib/predict", "../lib/team", "../lib/lineage", "../lib/money"].map(m));
  for (const e of w.events) calls.push([`night(${e.name})`, () => { const n = night.buildNight(w, e.id) as unknown; return n ? [n, night.nightLines(n, w, tEn)] : null; }], [`eventMoney(${e.name})`, () => moneyMod.eventMoney(w, e.id)]);
  for (const b of w.bouts) {
    calls.push([`recap(bout ${b.id})`, () => { const r = recap.buildRecap(w, b.id) as unknown; return r ? [r, recap.recapLines(r, w, tEn)] : null; }], [`boutPurses(${b.id})`, () => moneyMod.boutPurses(w, b.id)]);
    const red = w.byId.get(b.redId), blue = w.byId.get(b.blueId);
    if (red && blue) calls.push([`predict(${b.id})`, () => predict.predict(red, blue, tEn)]);
  }
  for (const x of w.boxers) calls.push([`similarTo(${x.name})`, () => style.similarTo(x, w)], [`boxerTeam(${x.name})`, () => team.boxerTeam(w, x.id)], [`careerMoney(${x.name})`, () => moneyMod.careerMoney(w, x.id)],
    [`reignsOf(${x.name})`, () => lineageMod.reignsOf(w, x.id)], [`recordsOf(${x.name})`, () => records.recordsOf(w, x.id)]);
  const lists = (records as unknown as { LISTS: { id: string }[] }).LISTS;
  for (const l of lists) calls.push([`records.recordList(${l.id})`, () => records.recordList(w, l.id, {})]);
  for (const [name, fn] of calls) {
    try { const out = fn(); for (const b of badNumbers(out)) bad.push(`${name}: ${b}`); }
    catch (e) { bad.push(`${name} threw: ${(e as Error).message}`); }
  }
  return bad;
}

const samples = (a: ArgSpec): unknown[] => a.kind === "enum" ? [...a.values] : a.kind === "number" ? [a.min, a.max] : a.kind === "boolean" ? [true] : ["Mexico", "zzzz-nobody"];

/** Runs every Ask-the-data tool (defaults and each argument alone) and reports problems with the results. */
export async function sweepAskTools(w: World): Promise<{ bad: string[]; runs: number }> {
  const { TOOLS, sanitizeArgs } = await import("../lib/ask/tools");
  const bad: string[] = []; let runs = 0;
  for (const tool of TOOLS) {
    const variants: Record<string, unknown>[] = [{}];
    for (const a of tool.args) for (const v of samples(a)) variants.push({ [a.name]: v });
    for (const raw of variants) {
      let r: ToolResult;
      try { r = tool.run({ w, t: tEn, names: {} as Names }, sanitizeArgs(tool, raw)); } catch (e) { bad.push(`${tool.name} ${JSON.stringify(raw)} threw: ${(e as Error).message}`); continue; }
      runs++;
      for (const p of askResultProblems(r, tool.name)) bad.push(`${tool.name} ${JSON.stringify(raw)}: ${p}`);
    }
  }
  return { bad, runs };
}

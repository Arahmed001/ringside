import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FeedData } from "../lib/feed";
import type { ProviderBoxer } from "../lib/providers";

/**
 * Points the app at a throwaway database and pins "today". Call it at the top of a test file, BEFORE any
 * dynamic import of lib/db (the path is read at import time). Returns a cleanup function.
 */
export function tempDb(tag: string, now = "2026-10-03") {
  process.env.RINGSIDE_NOW = now;
  const file = path.join(os.tmpdir(), `ringside-test-${tag}-${process.pid}.db`);
  process.env.DATABASE_PATH = file;
  // accounts live in their own file; give every test its own so none can read (or leave behind) a real one
  const accounts = file.replace(/\.db$/, "-accounts.db");
  process.env.ACCOUNTS_DB_PATH = accounts;
  const files = [file, accounts].flatMap((f) => ["", "-wal", "-shm"].map((e) => f + e));
  for (const f of files) fs.rmSync(f, { force: true });
  return () => { for (const f of files) fs.rmSync(f, { force: true }); };
}

const boxer = (id: string, division = "Lightweight", extra: Partial<ProviderBoxer> = {}): ProviderBoxer => ({
  externalId: id, name: `Fighter ${id}`, country: "Mexico", birthYear: 1994, stance: "Orthodox", heightCm: 175, reachCm: 178,
  weightClass: division, turnedPro: 2014, active: true, ...extra,
});

/** A minimal, fully valid feed: two fighters, one decided card with three judges. Tests mutate copies of it. */
export function miniFeed(): FeedData {
  return {
    boxers: [boxer("A"), boxer("B")],
    events: [{ externalId: "E1", name: "Test Night", date: "2025-01-10", venue: "Arena", city: "Las Vegas", country: "United States" }],
    bouts: [{
      externalId: "E1-1", eventExternalId: "E1", redExternalId: "A", blueExternalId: "B", weightClass: "Lightweight", rounds: 12,
      winnerExternalId: "A", method: "UD", endRound: 12, title: null, position: 0,
    }],
    people: [
      { externalId: "J1", name: "Judge One" }, { externalId: "J2", name: "Judge Two" }, { externalId: "J3", name: "Judge Three" },
      { externalId: "T1", name: "Trainer One" }, { externalId: "T2", name: "Trainer Two" }, { externalId: "R1", name: "Referee One" },
    ],
    orgs: [{ externalId: "G1", name: "Test Gym", kind: "gym" }],
    stints: [{ boxerExternalId: "A", role: "head_trainer", personExternalId: "T1", start: "2020-01-01", end: null, source: "test" }],
    weighIns: [
      { boutExternalId: "E1-1", boxerExternalId: "A", officialLb: 134.6, fightNightLb: 141.2, limitLb: 135, madeWeight: true },
      { boutExternalId: "E1-1", boxerExternalId: "B", officialLb: 134.8, fightNightLb: 140.5, limitLb: 135, madeWeight: true },
    ],
    officials: [{ boutExternalId: "E1-1", role: "referee", personExternalId: "R1" }, ...["J1", "J2", "J3"].map((j, i) => ({ boutExternalId: "E1-1", role: "judge" as const, personExternalId: j, seat: i + 1 }))],
    scorecards: [["J1", 116, 112], ["J2", 117, 111], ["J3", 115, 113]].map(([j, r, b], i) => ({ boutExternalId: "E1-1", judgeExternalId: j as string, seat: i + 1, red: r as number, blue: b as number })),
    corners: [{ boutExternalId: "E1-1", boxerExternalId: "A", role: "head_trainer", personExternalId: "T1" }],
    financials: [], purses: [], broadcasts: [], earnings: [], officialRankings: [],
    punches: [{ boutExternalId: "E1-1", boxerExternalId: "A", round: 0, thrown: 500, landed: 150, powerThrown: 200, powerLanded: 70 }],
  };
}
export { boxer as makeBoxer };

import type { DataProvider } from "../lib/providers";
/** Wraps a FeedData as a provider, so ingest can be exercised with hand-made feeds. */
export function providerOf(feed: FeedData, name = "test"): DataProvider {
  return {
    name,
    fetchBoxers: async () => feed.boxers, fetchEvents: async () => feed.events, fetchBouts: async () => feed.bouts,
    fetchPeople: async () => feed.people, fetchOrgs: async () => feed.orgs, fetchStints: async () => feed.stints,
    fetchWeighIns: async () => feed.weighIns, fetchOfficials: async () => feed.officials, fetchScorecards: async () => feed.scorecards,
    fetchCorners: async () => feed.corners, fetchPunchStats: async () => feed.punches,
    fetchFinancials: async () => feed.financials, fetchPurses: async () => feed.purses, fetchBroadcasts: async () => feed.broadcasts, fetchEarnings: async () => feed.earnings,
  };
}


// ---- shared checks for the "does the whole site cope with this league" tests ----
import type { Cell, ToolResult } from "../lib/ask/types";
const JUNK = /undefined|NaN|\[object|\{[a-z]+\}/;
const cellText = (c: Cell) => (typeof c === "string" ? c : c.text);

/** What is wrong with one Ask-the-data tool result: no summary, junk in the text, a ragged table, a link that is not a site path. */
export function askResultProblems(r: ToolResult, tool: string): string[] {
  const p: string[] = [];
  if (r.tool !== tool) p.push(`reports itself as ${r.tool}`);
  if (typeof r.summary !== "string" || !r.summary.trim()) p.push("no summary");
  if (JUNK.test(r.summary)) p.push(`summary: ${r.summary}`);
  for (const l of r.lines) if (typeof l !== "string" || JUNK.test(l)) p.push(`line: ${l}`);
  for (const t of r.tables) {
    if (!t.columns.length) p.push(`table ${t.id} has no columns`);
    for (const row of t.rows) {
      if (row.length !== t.columns.length) p.push(`table ${t.id}: a row has ${row.length} cells for ${t.columns.length} columns`);
      for (const c of row) {
        if (JUNK.test(cellText(c))) p.push(`table ${t.id}: cell "${cellText(c)}"`);
        if (typeof c !== "string" && c.href && !c.href.startsWith("/")) p.push(`table ${t.id}: link ${c.href} is not a site path`);
      }
    }
  }
  return p;
}

/** Every number reachable from `v` that is NaN or infinite (JSON would print these as null and hide them). */
export function badNumbers(v: unknown, path = "$", seen = new WeakSet<object>(), out: string[] = []): string[] {
  if (typeof v === "number") { if (!Number.isFinite(v)) out.push(`${path} = ${v}`); return out; }
  if (!v || typeof v !== "object" || seen.has(v)) return out;
  seen.add(v);
  if (v instanceof Map) { for (const [k, x] of v) badNumbers(x, `${path}[${String(k)}]`, seen, out); return out; }
  for (const [k, x] of Object.entries(v)) { if (out.length > 20) break; badNumbers(x, `${path}.${k}`, seen, out); }
  return out;
}

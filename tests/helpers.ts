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
  for (const ext of ["", "-wal", "-shm"]) fs.rmSync(file + ext, { force: true });
  return () => { for (const ext of ["", "-wal", "-shm"]) fs.rmSync(file + ext, { force: true }); };
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
    financials: [], purses: [], broadcasts: [], earnings: [],
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

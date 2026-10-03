import fs from "node:fs";
import type { DataProvider } from "./index";
import { emptyFeed, type FeedData } from "../feed";
import { normalizeMethod } from "../methods";

/**
 * Reads a feed from a JSON file shaped like FeedData (any missing array is treated as empty). This is how a vendor
 * sample gets evaluated before an adapter exists: convert the sample to this shape, then run `npm run data:check -- --file x.json`.
 * Result methods in vendor spelling ("Decision - Split", "Technical Knockout") are normalised on the way in.
 */
export function fileProvider(path: string): DataProvider {
  const load = (): FeedData => {
    const raw = JSON.parse(fs.readFileSync(path, "utf8")) as Partial<FeedData>;
    const feed = { ...emptyFeed(), ...raw };
    feed.bouts = feed.bouts.map((b) => {
      const m = b.method === null || b.method === undefined ? null : normalizeMethod(String(b.method));
      return { ...b, method: m ?? (b.method as never) }; // unknown stays as-is so the validator reports it
    });
    return feed;
  };
  return {
    name: "file",
    fetchBoxers: async () => load().boxers,
    fetchEvents: async () => load().events,
    fetchBouts: async () => load().bouts,
    fetchPeople: async () => load().people,
    fetchOrgs: async () => load().orgs,
    fetchStints: async () => load().stints,
    fetchWeighIns: async () => load().weighIns,
    fetchOfficials: async () => load().officials,
    fetchScorecards: async () => load().scorecards,
    fetchCorners: async () => load().corners,
    fetchPunchStats: async () => load().punches,
    fetchFinancials: async () => load().financials,
    fetchPurses: async () => load().purses,
    fetchBroadcasts: async () => load().broadcasts,
    fetchEarnings: async () => load().earnings,
  };
}

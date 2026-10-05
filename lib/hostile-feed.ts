import type { ApiFight, ApiFighter } from "./providers/boxing-data-api";

/**
 * A league made of the awkward values a real feed can hold, served through a fetch the real adapter reads (no network, no key): markup and quotes in names, absurd
 * heights, contradictory results, impossible dates, a fighter with no name. It is for proving two things about the whole pipeline (adapter, validator, ingest, world,
 * pages): nothing throws, and nothing is lost without being counted. The `<script>` text is here so a page that shows it unescaped is caught.
 * Used by tests/hostile-feed.test.ts and `npm run smoke -- --feed hostile`.
 */
export const HOSTILE_MARKUP = "<script>alert(1)</script>";

const f = (id: string, name: string | null, over: Partial<ApiFighter> = {}): ApiFighter => ({
  id, name, age: 30, gender: "m", nationality: "United Kingdom", nickname: null, stance: "orthodox", debut: "2012", height_cm: 180, reach_cm: 182, division: { name: "Welterweight" }, ...over,
});

export const HOSTILE_FIGHTERS: ApiFighter[] = [
  f("H1", "Control One"),
  f("H2", "W".repeat(300)),
  f("H3", `${HOSTILE_MARKUP} O'Brien "The Bomb" & Sons`, { nickname: "<img src=x onerror=alert(1)>" }),
  f("H4", "محمد 🥊 العلي", { nationality: "  usa  " }),
  f("H5", "Odd Facts", { nationality: null, gender: "x", stance: "banana", debut: "1850", height_cm: 0, reach_cm: 999, division: null }),
  f("H6", "Robert'); DROP TABLE boxers;--", { nationality: "Narnia" }),
  f("H7", "Control One"), // the same name as H1, a different fighter
  f("H8", "Negative Age", { age: -5, debut: "3000", height_cm: null, height_in: 7, reach_cm: null, reach_in: 300, division: { name: "Bridgerweight" } }),
  f("H9", "", { division: { name: "Catchweight" } }),
  f("H10", "Contradicting Totals", { stats: { wins: 5, losses: 0, draws: 0, total_bouts: 5, ko_wins: 99, stopped: -1, total_rounds: -3 } }),
  f("H11", "​​"), // a name of invisible characters only
  f("H12", "Long Nick", { nickname: "N".repeat(500), alias: "A".repeat(500) }),
];

const side = (id: string | null, winner: boolean | null) => ({ name: "x", full_name: "x x", winner, fighter_id: id });
const day = "2024-06-01";
const fight = (id: string, a: string | null, b: string | null, over: Partial<ApiFight> & { winA?: boolean | null; winB?: boolean | null } = {}): ApiFight => {
  const { winA = true, winB = false, ...rest } = over;
  return {
    id, title: `Card ${id}`, date: `${day}T20:00:00Z`, location: "London, United Kingdom", venue: "Arena", scheduled_rounds: 12, status: "FINISHED",
    fighters: { fighter_1: side(a, winA), fighter_2: side(b, winB) }, results: { outcome: "UD", round: null },
    event: { id: `ev-${id}`, title: `Card ${id}`, date: `${day}T20:00:00Z`, location: "London, United Kingdom", venue: "Arena" }, division: { name: "Welterweight" }, titles: [], ...rest,
  };
};

export const HOSTILE_FIGHTS: ApiFight[] = [
  fight("F01", "H1", "H2"),                                                                        // a control
  fight("F02", "H3", "H4", { results: { outcome: "KO", round: 3 } }),                                // markup and RTL names
  fight("F03", "H1", "H6", { results: { outcome: "DQ", round: 4 } }),                                // an outcome word the feed's list does not show
  fight("F04", "H2", "H4", { results: { outcome: "Technical Decision", round: 6 } }),
  fight("F05", "H1", "H4", { results: { outcome: "Walkover", round: null } }),                       // an outcome nobody can read, with a winner
  fight("F06", "H3", "H6", { results: { outcome: "KO", round: "abc" } }),                            // an unreadable round
  fight("F07", "H2", "H6", { results: { outcome: "TKO", round: 0 } }),                               // round 0
  fight("F08", "H3", "H1", { results: { outcome: "TKO", round: 99 }, scheduled_rounds: 12 }),         // round 99 of 12
  fight("F09", "H4", "H6", { scheduled_rounds: 0 }),                                                 // no scheduled rounds
  fight("F10", "H2", "H3", { scheduled_rounds: 100 }),                                               // a hundred rounds
  fight("F11", "H1", "H2", { date: "2024-02-30T20:00:00Z", event: { id: "ev-F11", title: "Impossible date", date: "2024-02-30T20:00:00Z", location: "London, United Kingdom", venue: "Arena" } }),
  fight("F12", "H3", "H4", { date: "2031-01-01T20:00:00Z", event: { id: "ev-F12", title: "Finished in the future", date: "2031-01-01T20:00:00Z", location: "London, United Kingdom", venue: "Arena" } }),
  fight("F13", "H1", "H3", { winA: true, winB: true }),                                              // both marked as the winner
  fight("F14", "H1", "H1"),                                                                          // a fighter against himself
  fight("F15", "H1", null),                                                                          // a fighter missing
  fight("F16", "H5", "H1", { location: "a, b, c, d, e, f", venue: null }),                           // a location with many commas, no venue
  fight("F17", "H5", "H8", { location: null, venue: null, event: { id: "ev-F17", title: null, date: `${day}T20:00:00Z`, location: null, venue: null } }),
  fight("F18", "H1", "H5", { division: { name: "Catchweight" } }),                                   // a fight in no division
  fight("F19", "H1", "H9", { division: null }),                                                      // and one with none at all
  fight("F20", "H10", "H1", { status: "FINISHED", results: null }),                                  // finished with no results object
  fight("F21", "H1", "H2", { status: "LIVE" }),
  fight("F22", "H3", "H1", { status: "POSTPONED" }),                                                 // a status nobody listed
  fight("F23", "H1", "H3", { titles: [{ name: "T".repeat(300), id: "t" }] }),
  fight("F24", "H2", "H1", { scores: ["abc", "999-999", "116-109", "1-2", "115-113", "x"] }),         // junk beside a real card
  fight("F25", "H11", "H12", { results: { outcome: "UD", round: null } }),
  fight("F26", "H8", "H1", { winA: null, winB: null, results: { outcome: "KO", round: 2 } }),        // a knockout with no winner
  fight("F27", "H7", "H1"),                                                                          // the duplicate name against the original
  fight("F01", "H3", "H4"),                                                                          // a repeated fight id
];

/** A fetch that serves the league above as the vendor's API would (fights in one page, fighters by id). */
export function hostileFetch(): typeof fetch {
  const env = <T,>(data: T) => ({ metadata: {}, pagination: { page: 1, total_pages: 1, next_page: null }, error: {}, data });
  return (async (url: string) => {
    const u = new URL(url);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (u.pathname === "/v2/fights/") return ok(env(HOSTILE_FIGHTS));
    if (u.pathname === "/v2/fights/schedule") return ok(env([]));
    if (u.pathname === "/v2/rankings/") return ok(env([]));
    const m = u.pathname.match(/^\/v2\/fighters\/(.+)$/);
    const fighter = m && HOSTILE_FIGHTERS.find((x) => x.id === m[1]);
    if (fighter) return ok(env(fighter));
    return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
  }) as unknown as typeof fetch;
}

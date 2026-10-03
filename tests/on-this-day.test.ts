import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBoxer, miniFeed, tempDb } from "./helpers";
import { LEAP, countOn, dayOf, importance, nearestWithContent, onThisDay, parseDay, shiftDay } from "../lib/on-this-day";

/**
 * A league small enough to work out by hand (today is pinned to 2026-10-03, so the day of the year is 10-03).
 *
 *  bout  date        fight   result                                     on 10-03?
 *   1    2019-10-03  A v B   A UD, WBC world title                      yes (title)
 *   2    2021-10-03  C v D   C KO R2                                    yes
 *   3    2022-10-03  B v C   no contest                                 yes: a result is on record
 *   4    2023-10-03  D v E   D UD                                       yes
 *   5    2024-02-29  A v C   A UD                                       no: it is the leap day, 02-29
 *   6    2026-10-03  E v A   E UD, today                                yes: today's result is in
 *   7    2027-10-03  A v B   upcoming, no result                        NO: not happened
 *   8    2020-10-03  B v D   cancelled                                  NO: never took place
 *   9    2025-10-03  E v C   E UD                                       yes
 *  10    2027-10-04  C v D   UD, but dated in the future (bad data)     NO: after today
 *  11    2018-12-25  I v J   4 rounds, "Regional Title", I UD           12-25
 *  12    2017-12-25  K v L   4 rounds, no title, K UD                   12-25
 *  13    2017-12-25  M v N   4 rounds, no title, M UD                   12-25 (same year as 12: two fights, one year)
 *  14    2020-10-03  C v E   cancelled, but with a result entered (bad data)   NO: it never took place
 * 15-19  2017-05-05  five 4-round fights between fresh fighters (all rated alike, so ties go to the earlier entered)   05-05
 *  20    2016-05-05  a sixth, a year earlier                                                                     05-05
 *
 *  born:  A 1990-10-03, B 1985-10-03, C 1992-02-29, D 1991-10-04, E no exact date, G 2027-10-03 (future: bad data), H 1990-02-29 (no such day)
 *
 * So by hand: 10-03 has 6 fights in 6 different years and 2 births (A, B); 02-29 has 1 fight and 1 birth (C); 10-04 has 1 birth (D) and no fights
 * (bout 10 is in the future); 12-25 has 3 fights in 2 years and no births; 05-05 has 6 fights in 2 years; every other day is empty.
 */
const cleanup = tempDb("on-this-day");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-otd-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
const named = (n: string) => w.boxers.find((b) => b.name === `Fighter ${n}`)!;
const bout = (n: number) => w.bouts.find((b) => b.eventName === `Card ${n}`)!;

before(async () => {
  const feed = miniFeed();
  const born = (d: string | undefined) => (d ? { birthDate: d } : {});
  feed.boxers = [
    ...[15, 16, 17, 18, 19, 20].flatMap((n) => [makeBoxer(`P${n}a`, "Lightweight"), makeBoxer(`P${n}b`, "Lightweight")]),
    makeBoxer("A", "Lightweight", born("1990-10-03")), makeBoxer("B", "Lightweight", born("1985-10-03")), makeBoxer("C", "Lightweight", born("1992-02-29")),
    makeBoxer("D", "Lightweight", born("1991-10-04")), makeBoxer("E", "Lightweight", born(undefined)), makeBoxer("G", "Lightweight", born("2027-10-03")),
    makeBoxer("H", "Lightweight", born("1990-02-29")),
    ...["I", "J", "K", "L", "M", "N"].map((x) => makeBoxer(x, "Lightweight")),
  ];
  type Row = [number, string, string, string, string | null, string, number | undefined, string | null, string | undefined, number];
  const rows: Row[] = [
    [1, "2019-10-03", "A", "B", "A", "UD", 12, "WBC Lightweight World Title", undefined, 12], [2, "2021-10-03", "C", "D", "C", "KO", 2, null, undefined, 12],
    [3, "2022-10-03", "B", "C", null, "NC", 3, null, undefined, 12], [4, "2023-10-03", "D", "E", "D", "UD", 12, null, undefined, 12],
    [5, "2024-02-29", "A", "C", "A", "UD", 12, null, undefined, 12], [6, "2026-10-03", "E", "A", "E", "UD", 12, null, undefined, 12],
    [7, "2027-10-03", "A", "B", null, "", undefined, null, undefined, 12], [8, "2020-10-03", "B", "D", null, "", undefined, null, "cancelled", 12],
    [9, "2025-10-03", "E", "C", "E", "UD", 12, null, undefined, 12], [10, "2027-10-04", "C", "D", "C", "UD", 12, null, undefined, 12],
    [11, "2018-12-25", "I", "J", "I", "UD", 4, "Regional Title", undefined, 4], [12, "2017-12-25", "K", "L", "K", "UD", 4, null, undefined, 4],
    [13, "2017-12-25", "M", "N", "M", "UD", 4, null, undefined, 4], [14, "2020-10-03", "C", "E", "C", "UD", 12, null, "cancelled", 12],
    ...[15, 16, 17, 18, 19, 20].map((n): Row => [n, n === 20 ? "2016-05-05" : "2017-05-05", `P${n}a`, `P${n}b`, `P${n}a`, "UD", 4, null, undefined, 4]),
  ];
  feed.events = rows.map(([n, date, , , , , , , st]) => ({ externalId: `EV${n}`, name: `Card ${n}`, date, venue: "Arena", city: "Reno", country: "United States", ...(st ? { status: st } : {}) }) as never);
  feed.bouts = rows.map(([n, , r, u, win, method, end, title, st, rounds]) => ({
    externalId: `B${n}`, eventExternalId: `EV${n}`, redExternalId: r, blueExternalId: u, weightClass: "Lightweight", rounds, winnerExternalId: win, method: (method || null) as never,
    endRound: end ?? null, title, position: 1, ...(st ? { status: st } : {}),
  }) as never);
  feed.weighIns = []; feed.scorecards = []; feed.officials = []; feed.corners = []; feed.punches = []; feed.stints = [];
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  w = await (await import("../lib/world")).getWorld();
});

test("parseDay accepts a real day of the year (29 February included) and nothing else", () => {
  assert.deepEqual(["10-03", "02-29", "01-01", "12-31", " 10-03 "].map(parseDay), ["10-03", "02-29", "01-01", "12-31", "10-03"]);
  for (const bad of ["02-30", "04-31", "13-01", "00-10", "10-00", "1-1", "10-3", "2026-10-03", "10/03", "", "ab-cd", "10-03-", undefined, null]) assert.equal(parseDay(bad as never), null, String(bad));
});

test("dayOf reads a date's day of the year; 29 February only counts in a leap year", () => {
  assert.equal(dayOf("2026-10-03"), "10-03");
  assert.equal(dayOf("2024-02-29"), "02-29");
  assert.equal(dayOf("2000-02-29"), "02-29", "2000 was a leap year");
  assert.equal(dayOf("1900-02-29"), null, "1900 was not");
  assert.equal(dayOf("2023-02-29"), null);
  for (const bad of ["2026-13-01", "2026-10", "10-03", "", null, undefined, "2026-10-3"]) assert.equal(dayOf(bad as never), null, String(bad));
});

test("shiftDay walks the 366-day year, across New Year and through 29 February", () => {
  assert.equal(shiftDay("10-03", 1), "10-04"); assert.equal(shiftDay("10-03", -1), "10-02");
  assert.equal(shiftDay("12-31", 1), "01-01"); assert.equal(shiftDay("01-01", -1), "12-31");
  assert.equal(shiftDay("02-28", 1), "02-29"); assert.equal(shiftDay("02-29", 1), "03-01"); assert.equal(shiftDay("03-01", -1), "02-29");
  assert.equal(shiftDay("12-31", 60), "02-29", "Jan has 31 days and Feb 29: a walk across New Year must still land on the leap day");
  assert.equal(shiftDay("12-31", 61), "03-01");
  assert.equal(shiftDay("03-01", -61), "12-31");
  for (const k of ["01-01", "02-29", "10-03", "12-31"]) { assert.equal(shiftDay(k, 366), k); assert.equal(shiftDay(k, -366), k); assert.equal(shiftDay(k, 732), k); assert.equal(shiftDay(k, -1000), shiftDay(k, -1000 + 366 * 3)); }
  const all = new Set(Array.from({ length: 366 }, (_, i) => shiftDay("01-01", i)));
  assert.equal(all.size, 366, "every day of the year is visited exactly once");
  assert.ok(all.has("02-29"));
  assert.equal(LEAP, 2000);
});

test("a day lists the results on record for it, and only those", () => {
  const p = onThisDay(w, "10-03");
  assert.deepEqual(p.fights.map((f) => f.bout.date), ["2026-10-03", "2025-10-03", "2023-10-03", "2022-10-03", "2021-10-03", "2019-10-03"], "newest year first; bouts 7 (upcoming), 8 and 14 (cancelled, one with a result entered) are out");
  assert.equal(p.fightTotal, 6);
  assert.equal(p.fightYears, 6);
  assert.ok(p.fights.some((f) => f.bout.id === bout(3).id), "a no contest is a result on record");
  assert.ok(p.fights.some((f) => f.bout.id === bout(6).id), "today's finished fight is in");
  assert.ok(!p.fights.some((f) => [7, 8, 14].includes(Number(w.eventById.get(f.bout.eventId)!.name.replace("Card ", "")))), "no upcoming or cancelled bout");
});

test("a result dated after today (bad data) never appears, and neither does a birthday after today", () => {
  const p = onThisDay(w, "10-04");
  assert.equal(p.fightTotal, 0, "bout 10 has a result but is dated 2027");
  assert.deepEqual(p.births.map((b) => b.name), ["Fighter D"]);
  assert.ok(!onThisDay(w, "10-03").births.some((b) => b.name === "Fighter G"), "G is 'born' in 2027");
});

test("birthdays: exact dates only, best-rated first; a year-only fighter and an impossible date are left out", () => {
  const p = onThisDay(w, "10-03");
  assert.deepEqual(p.births.map((b) => b.name), ["Fighter A", "Fighter B"], "A beat B head to head and has not lost to anyone else's lower rung: higher rating");
  assert.ok(named("A").rating > named("B").rating, "the order is the rating order");
  assert.equal(p.birthTotal, 2);
  assert.equal(countOn(w, "02-29").births, 1, "H's 1990-02-29 does not exist, so it is not on 29 February; C (1992) is");
  assert.deepEqual(onThisDay(w, "02-29").births.map((b) => b.name), ["Fighter C"]);
  const everyone = Array.from({ length: 366 }, (_, i) => countOn(w, shiftDay("01-01", i)).births).reduce((s, n) => s + n, 0);
  assert.equal(everyone, 4, "A, B, C, D only: not E (no day), G (future), H (impossible)");
});

test("the leap day holds its own fight and birthday, and the other 28th and 1st do not", () => {
  const p = onThisDay(w, "02-29");
  assert.deepEqual([p.fightTotal, p.birthTotal, p.fights[0].bout.date], [1, 1, "2024-02-29"]);
  assert.deepEqual([countOn(w, "02-28"), countOn(w, "03-01")], [{ fights: 0, births: 0 }, { fights: 0, births: 0 }]);
});

test("a crowded day keeps the most important fights: a title first, then the rest by score and rating; shown newest first", () => {
  const all = onThisDay(w, "12-25");
  assert.deepEqual([all.fightTotal, all.fightYears], [3, 2], "three fights in two different years");
  assert.deepEqual(all.fights.map((f) => f.bout.date), ["2018-12-25", "2017-12-25", "2017-12-25"]);
  assert.deepEqual(all.fights.map((f) => f.bout.id), [bout(11).id, bout(12).id, bout(13).id], "the same date: the earlier entered first");
  const two = onThisDay(w, "12-25", { fights: 2 });
  assert.deepEqual(two.fights.map((f) => f.bout.id), [bout(11).id, bout(12).id], "the title fight and, on a tie between the other two, the one entered first");
  assert.equal(two.fightTotal, 3, "the total still counts the ones not shown");
  assert.deepEqual(onThisDay(w, "12-25", { fights: 1 }).fights.map((f) => f.bout.date), ["2018-12-25"]);
  assert.ok(importance(w, bout(11)) > 40 && importance(w, bout(11)) < 41, "40 for the title, 0 for a 4-round fight's score, and a rating tie-break under 1");
  assert.ok(importance(w, bout(12)) < 1);
  assert.equal(onThisDay(w, "12-25").fights[0].score, null, "a 4-round fight has no fight score, and the page shows none rather than 0");
});

test("no one year crowds the others out: three a year on the first pass, and the spare places are filled afterwards", () => {
  const id = (n: number) => bout(n).id;
  const all = onThisDay(w, "05-05");
  assert.deepEqual([all.fightTotal, all.fightYears], [6, 2]);
  assert.deepEqual(all.fights.map((f) => f.bout.id), [id(15), id(16), id(17), id(18), id(19), id(20)], "twelve places, six fights: all shown, newest year first, ties in the order entered");
  assert.deepEqual(onThisDay(w, "05-05", { fights: 4 }).fights.map((f) => f.bout.id), [id(15), id(16), id(17), id(20)], "three from 2017, then the 2016 fight instead of a fourth from 2017");
  assert.deepEqual(onThisDay(w, "05-05", { fights: 5 }).fights.map((f) => f.bout.id), [id(15), id(16), id(17), id(18), id(20)], "the fifth place is the first skipped fight");
  assert.deepEqual(onThisDay(w, "05-05", { fights: 3 }).fights.map((f) => f.bout.id), [id(15), id(16), id(17)]);
});

test("a scored fight carries the same score the rest of the site shows", async () => {
  const { scoreFight } = await import("../lib/fight-score");
  const p = onThisDay(w, "10-03");
  for (const f of p.fights) assert.equal(f.score, scoreFight(w, f.bout)?.score ?? null);
  assert.deepEqual(p.fights.filter((f) => f.score === null).map((f) => f.bout.id), [bout(3).id], "every 12-round fight is scored; the no contest is the one that is not (lib/fight-score.ts leaves NC out)");
  assert.ok(importance(w, bout(1)) >= 40, "the world title fight carries the title bonus");
});

test("an empty day points at the nearest days that have something, either way round the year", () => {
  assert.deepEqual(countOn(w, "07-04"), { fights: 0, births: 0 });
  assert.deepEqual(nearestWithContent(w, "07-04", 1), { key: "10-03", fights: 6, births: 2 });
  assert.deepEqual(nearestWithContent(w, "07-04", -1), { key: "05-05", fights: 6, births: 0 });
  assert.deepEqual(nearestWithContent(w, "10-03", 1), { key: "10-04", fights: 0, births: 1 });
  assert.deepEqual(nearestWithContent(w, "10-03", -1), { key: "05-05", fights: 6, births: 0 });
  assert.deepEqual(nearestWithContent(w, "05-05", -1), { key: "02-29", fights: 1, births: 1 });
  assert.deepEqual(nearestWithContent(w, "12-25", 1), { key: "02-29", fights: 1, births: 1 }, "forward from Christmas wraps past New Year");
  assert.deepEqual(nearestWithContent(w, "02-29", -1), { key: "12-25", fights: 3, births: 0 }, "and backwards from the leap day wraps to Christmas");
  assert.equal(nearestWithContent(w, "07-04", 1) === null, false);
});

test("a database with no fights and no birthdays has nothing to point at, and nothing breaks", () => {
  const none = { bouts: [], boxers: [], today: "2026-10-03" } as unknown as World;
  assert.equal(nearestWithContent(none, "10-03", 1), null);
  assert.equal(nearestWithContent(none, "10-03", -1), null);
  const p = onThisDay(none, "10-03");
  assert.deepEqual([p.fights, p.births, p.fightTotal, p.birthTotal, p.fightYears], [[], [], 0, 0, 0]);
});

test("the page is in the sitemap, the navigation, ⌘K and the smoke routes", async () => {
  const { sitemapPaths } = await import("../lib/sitemap");
  assert.ok(sitemapPaths(w).some((p) => p.path === "/on-this-day"));
  const { PAGES } = await import("../lib/search");
  assert.ok(PAGES.some((p) => p.href === "/on-this-day"));
  const { smokeRoutes } = await import("../lib/smoke");
  const routes = smokeRoutes(w);
  const paths = routes.map((r) => r.path);
  for (const p of ["/on-this-day", "/on-this-day?d=10-03", "/on-this-day?d=02-29"]) assert.ok(paths.includes(p), p);
  assert.equal(routes.find((r) => r.path === "/on-this-day?d=02-30")?.kind, "missing", "a date that does not exist is a 404");
  assert.ok(paths.some((p) => /^\/on-this-day\?d=\d\d-\d\d$/.test(p) && countOn(w, p.slice(-5)).fights + countOn(w, p.slice(-5)).births === 0), "and a day with nothing on it is covered");
});

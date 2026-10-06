import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { escapeText, foldLine, icsText, type IcsCalendar } from "../lib/ics";
import { calendarPath } from "../lib/calendar-link";
import { makeBoxer, miniFeed, tempDb } from "./helpers";

/** A small reader of the format, enough to prove that what is written reads back: unfold, split into components and properties. */
function parse(text: string) {
  assert.ok(text.endsWith("\r\n"), "ends with CRLF");
  assert.ok(!/[^\r]\n/.test(text), "every line break is CRLF");
  const lines = text.slice(0, -2).split("\r\n").reduce<string[]>((acc, l) => { if (l.startsWith(" ")) acc[acc.length - 1] += l.slice(1); else acc.push(l); return acc; }, []);
  const events: Record<string, string>[] = [];
  let cur: Record<string, string> | null = null; const head: Record<string, string> = {};
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") { cur = {}; continue; }
    if (l === "END:VEVENT") { events.push(cur!); cur = null; continue; }
    const i = l.indexOf(":"), key = l.slice(0, i).split(";")[0], val = l.slice(i + 1);
    (cur ?? head)[key] = val;
  }
  return { head, events, lines };
}
const unescape = (s: string) => s.replace(/\\n/g, "\n").replace(/\\([,;\\])/g, "$1");
const octets = (s: string) => new TextEncoder().encode(s).length;

test("text is escaped as the format requires, and a long line is folded between characters at 75 octets", () => {
  assert.equal(escapeText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne", "a comma, a semicolon, a backslash and a line break are each escaped (RFC 5545 3.3.11); the semicolon was not, because the source had \"\\;\" which JavaScript reads as a plain semicolon");
  const ascii = "SUMMARY:" + "x".repeat(200);
  const folded = foldLine(ascii);
  assert.ok(folded.length > 2 && folded.every((l) => octets(l) <= 75), "no physical line over 75 octets");
  assert.ok(folded.slice(1).every((l) => l.startsWith(" ")), "continuations start with a space");
  assert.equal(folded.map((l, i) => (i ? l.slice(1) : l)).join(""), ascii, "unfolding gives the line back");
  const arabic = "SUMMARY:" + "فوز تايسون فيوري على أوليكساندر أوسيك في نزال الوزن الثقيل".repeat(3);
  const fa = foldLine(arabic);
  assert.ok(fa.every((l) => octets(l) <= 75), "Arabic lines fold on octets too");
  assert.equal(fa.map((l, i) => (i ? l.slice(1) : l)).join(""), arabic, "and no character is cut in two");
  assert.deepEqual(foldLine("short"), ["short"]);
  const emoji = "X:" + "🏴󠁧󠁢󠁥󠁮󠁧󠁿".repeat(30);
  assert.equal(foldLine(emoji).map((l, i) => (i ? l.slice(1) : l)).join(""), emoji, "a character outside the basic plane is not split");
});

test("a calendar: all-day events with an exclusive end, a stable UID, sorted, cancelled marked, language and stamp", () => {
  const cal: IcsCalendar = { name: "Fights, I follow", lang: "en", stamp: "2026-10-03T00:00:00Z", description: "Line one\nline two", events: [
    { uid: "bout-2@x.test", date: "2026-12-31", summary: "B vs C", status: "CANCELLED" },
    { uid: "bout-1@x.test", date: "2026-10-20", summary: "A vs B; the rematch", description: "Main card\nhttps://x.test/bouts/1", location: "T-Mobile Arena, Las Vegas", url: "https://x.test/bouts/1" },
  ] };
  const text = icsText(cal), p = parse(text);
  assert.equal(p.head.VERSION, "2.0"); assert.equal(p.head.METHOD, "PUBLISH"); assert.equal(unescape(p.head["X-WR-CALNAME"]), "Fights, I follow"); assert.equal(unescape(p.head["X-WR-CALDESC"]), "Line one\nline two");
  assert.deepEqual(p.events.map((e) => e.UID), ["bout-1@x.test", "bout-2@x.test"], "in date order");
  assert.equal(p.events[0].DTSTART, "20261020"); assert.equal(p.events[0].DTEND, "20261021"); assert.ok(text.includes("DTSTART;VALUE=DATE:20261020"));
  assert.equal(p.events[1].DTEND, "20270101", "the end crosses a year");
  assert.equal(unescape(p.events[0].SUMMARY), "A vs B; the rematch"); assert.equal(unescape(p.events[0].DESCRIPTION), "Main card\nhttps://x.test/bouts/1");
  assert.equal(p.events[0].STATUS, "CONFIRMED"); assert.equal(p.events[1].STATUS, "CANCELLED"); assert.equal(p.events[0].DTSTAMP, "20261003T000000Z");
  assert.ok(text.includes("SUMMARY;LANGUAGE=en:")); assert.equal(icsText(cal), text, "the same input is the same text");
  assert.equal(p.events.length, 2); assert.ok(p.lines.filter((l) => l === "BEGIN:VCALENDAR").length === 1 && p.lines.at(-1) === "END:VCALENDAR");
});

test("the address of a calendar: no language prefix (the feed is not a page), the language as ?lang= except for English", () => {
  assert.equal(calendarPath({ event: 12 }, "en"), "/feeds/calendar.ics?event=12");
  assert.equal(calendarPath({ bout: 7 }, "ar"), "/feeds/calendar.ics?bout=7&lang=ar");
  assert.equal(calendarPath({ slugs: ["a-b", "c d"], days: 180 }, "ar"), "/feeds/calendar.ics?slugs=a-b%2Cc%20d&days=180&lang=ar");
  assert.equal(calendarPath({ slugs: [] }, "en"), "/feeds/calendar.ics?slugs=");
});

// ---- over a league ----
const cleanup = tempDb("calendar", "2026-10-03");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-cal-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });
type Get = (q: string) => Promise<{ status: number; type: string; disposition: string | null; body: string }>;
let get: Get;

before(async () => {
  const feed = miniFeed();
  const name = (id: string, n: string, extra = {}) => makeBoxer(id, "Lightweight", { name: n, ...extra });
  feed.boxers = [name("A", "Alma Ruiz"), name("B", "Bea Cole"), name("C", "Cyrus Dean"), name("D", "Dov Eden"), name("E", "Eli Fox"), name("F", "Fay Gil"), name("G", "Gus Hay")];
  feed.events = [
    { externalId: "E1", name: "Past Night", date: "2026-01-10", venue: "Arena", city: "Las Vegas", country: "United States" },
    { externalId: "E2", name: "October, Main; Night", date: "2026-10-20", venue: "T-Mobile Arena", city: "Las Vegas", country: "United States" },
    { externalId: "E3", name: "Far Night", date: "2027-03-01", venue: "O2 Arena", city: "London", country: "United Kingdom" },
    { externalId: "E4", name: "Cancelled Night", date: "2026-10-25", venue: "Hall", city: "Leeds", country: "United Kingdom" },
  ];
  const bout = (id: string, ev: string, red: string, blue: string, extra = {}) => ({ externalId: id, eventExternalId: ev, redExternalId: red, blueExternalId: blue, weightClass: "Lightweight", rounds: 12, winnerExternalId: null, method: null, endRound: null, title: null, position: 0, ...extra });
  feed.bouts = [
    { ...feed.bouts[0], externalId: "P1", eventExternalId: "E1", redExternalId: "A", blueExternalId: "B", winnerExternalId: "A", position: 0 },
    bout("U1", "E2", "A", "C", { title: "WBC World Lightweight Champion", position: 0 }), bout("U2", "E2", "D", "E", { position: 1 }),
    bout("U3", "E3", "A", "F", { position: 0 }), bout("U4", "E4", "B", "G", { position: 0, status: "cancelled" }), bout("U5", "E2", "F", "G", { position: 2, status: "cancelled" }),
  ] as never;
  feed.weighIns = []; feed.scorecards = []; feed.officials = []; feed.corners = []; feed.punches = [];
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file; process.env.SITE_URL = "https://ringside.test";
  const route = await import("../app/feeds/calendar.ics/route");
  get = async (q) => { const r = await route.GET(new Request(`https://ringside.test/feeds/calendar.ics${q}`)); return { status: r.status, type: r.headers.get("content-type") ?? "", disposition: r.headers.get("content-disposition"), body: await r.text() }; };
});

test("the default calendar is the cards of the next 60 days: one entry per card, headed by its main event, never a cancelled card or a far one", async () => {
  const r = await get(""); assert.equal(r.status, 200); assert.match(r.type, /^text\/calendar; charset=utf-8/); assert.match(r.disposition ?? "", /^inline/);
  const p = parse(r.body);
  assert.deepEqual(p.events.map((e) => e.UID), ["event-" + p.events[0].UID.slice(6, p.events[0].UID.indexOf("@")) + "@ringside.test"], "one card");
  const e = p.events[0];
  assert.equal(e.DTSTART, "20261020"); assert.equal(unescape(e.SUMMARY), "October, Main; Night: Dov Eden vs Eli Fox", "headed by the main event (the last bout on the card)");
  const description = unescape(e.DESCRIPTION); assert.match(description, /Dov Eden vs Eli Fox \(Lightweight\)\nAlma Ruiz vs Cyrus Dean \(Lightweight\)\n/); assert.ok(!description.includes("Fay Gil"), "a cancelled bout is not listed");
  assert.match(description, /https:\/\/ringside\.test\/events\/\d+$/); assert.equal(unescape(e.LOCATION), "T-Mobile Arena, Las Vegas, United States"); assert.ok(e.URL.startsWith("https://ringside.test/events/"));
  assert.equal(parse((await get("?days=400")).body).events.length, 2, "a longer window adds the far card (never the cancelled one)");
  assert.equal(parse((await get("?days=1")).body).events.length, 0, "a day ahead holds nothing");
});

test("a watchlist calendar has one entry per upcoming fight of the fighters, with a cancelled fight marked, nothing twice, and unknown names ignored", async () => {
  const r = await get("?slugs=alma-ruiz,cyrus-dean,nobody-here,bea-cole,gus-hay&days=200");
  const p = parse(r.body);
  const byUid = Object.fromEntries(p.events.map((e) => [e.UID.split("@")[0], e]));
  assert.equal(p.events.length, 4, "A v C once although both are starred; D v E is nobody's; A v F (2027-03-01) is inside 200 days");
  const names = p.events.map((e) => unescape(e.SUMMARY)).sort();
  assert.deepEqual(names, ["Alma Ruiz vs Cyrus Dean · WBC World Lightweight Champion", "Alma Ruiz vs Fay Gil", "Bea Cole vs Gus Hay", "Fay Gil vs Gus Hay"]);
  assert.equal(Object.values(byUid).filter((e) => e.STATUS === "CANCELLED").length, 2, "both cancelled fights are kept, marked CANCELLED");
  assert.equal(unescape(p.head["X-WR-CALNAME"]), "Fights I follow");
  const near = parse((await get("?slugs=alma-ruiz&days=30")).body).events.map((e) => unescape(e.SUMMARY));
  assert.deepEqual(near, ["Alma Ruiz vs Cyrus Dean · WBC World Lightweight Champion"], "only the fights inside the window: the March fight is out");
  assert.equal(parse((await get("?slugs=alma-ruiz&days=9999")).body).events.length, 2, "days is capped at a year, and the March fight is inside that");
  assert.equal(parse((await get("?slugs=nobody-here")).body).events.length, 0, "an unknown name makes a valid, empty calendar");
  assert.equal(parse((await get("?slugs=")).body).events.length, 0, "an empty list is empty, not everything");
});

test("one card and one fight download as files; unknown ones are 404 and a bad number is 400; Arabic text comes through folded and whole", async () => {
  const all = parse((await get("?days=400")).body).events.map((e) => e.UID);
  const eventId = all[0].slice("event-".length, all[0].indexOf("@"));
  const one = await get(`?event=${eventId}`); assert.equal(one.status, 200); assert.match(one.disposition ?? "", new RegExp(`^attachment; filename="ringside-event-${eventId}\\.ics"`)); assert.equal(parse(one.body).events.length, 1);
  const slugBouts = parse((await get("?slugs=alma-ruiz&days=100")).body).events;
  const boutId = slugBouts[0].UID.slice("bout-".length, slugBouts[0].UID.indexOf("@"));
  const b = parse((await get(`?bout=${boutId}`)).body); assert.equal(b.events.length, 1); assert.equal(b.events[0].URL, `https://ringside.test/bouts/${boutId}`);
  assert.equal((await get("?event=99999")).status, 404); assert.equal((await get("?bout=99999")).status, 404);
  for (const bad of ["?event=abc", "?bout=-1", "?days=ten", "?event=1.5"]) assert.equal((await get(bad)).status, 400, bad);
  const ar = await get(`?slugs=alma-ruiz&days=100&lang=ar`); const pa = parse(ar.body);
  assert.ok(ar.body.split("\r\n").every((l) => octets(l) <= 75), "every physical line fits (the raw lines, before unfolding)"); assert.ok(ar.body.includes("SUMMARY;LANGUAGE=ar:")); assert.equal(unescape(pa.head["X-WR-CALNAME"]), "النزالات التي أتابعها");
  assert.match(unescape(pa.events[0].SUMMARY), / ضد /, "the fight line is Arabic");
  assert.ok(pa.events[0].URL.startsWith("https://ringside.test/ar/bouts/"), "links keep the language");
});

test("the smoke check for a calendar: a good file passes, and each way a calendar app would choke is reported", async () => {
  const { problemsIn } = await import("../lib/smoke");
  const route = { path: "/feeds/calendar.ics", kind: "ics" as const, label: "calendar" };
  const good = icsText({ name: "x", lang: "en", stamp: "2026-10-03T00:00:00Z", events: [{ uid: "bout-1@x.test", date: "2026-10-20", summary: "A vs B" }] });
  assert.deepEqual(problemsIn(route, "en", 200, "text/calendar; charset=utf-8", good), []);
  assert.match(problemsIn(route, "en", 200, "text/plain", good).join(), /not a calendar/);
  assert.match(problemsIn(route, "en", 200, "text/calendar", good.replaceAll("\r\n", "\n")).join(), /not CRLF/);
  assert.match(problemsIn(route, "en", 200, "text/calendar", good.replace("END:VCALENDAR\r\n", "")).join(), /whole VCALENDAR/);
  assert.match(problemsIn(route, "en", 200, "text/calendar", good.replace("SUMMARY;LANGUAGE=en:A vs B", "SUMMARY;LANGUAGE=en:" + "y".repeat(120))).join(), /over 75 octets/);
  assert.match(problemsIn(route, "en", 200, "text/calendar", good.replace("END:VEVENT\r\n", "")).join(), /does not end/);
  assert.deepEqual(problemsIn(route, "en", 404, "text/plain", "no such event"), ["status 404"]);
});

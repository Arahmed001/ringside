import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";
import { hostOf, numberStated, numbersIn, squash } from "../lib/research/text";
import { PoliteFetcher, parseRobots, robotsAllows, type FetchOutcome } from "../lib/research/fetcher";
import { checkFacts, factId, nameKey, shapeProblems } from "../lib/research/check";
import { decisionProblems, staleDecisions, type Decision } from "../lib/research/decisions";
import { extractFromPage } from "../lib/research/extract";
import { matchFacts, sameBoxer } from "../lib/research/match";
import type { ResearchFact } from "../lib/research/types";

const cleanup = tempDb("research");
after(cleanup);

test("numbers in a quote: scales, commas and rounding", () => {
  assert.ok(numberStated(72_198_500, "a live gate of $72,198,500, a record"));
  assert.ok(numberStated(72_198_500, "gate of $72.2 million"), "a rounded headline figure matches");
  assert.ok(numberStated(4_600_000, "4.6M buys"));
  assert.ok(numberStated(410_000_000, "$410 million in revenue"));
  assert.ok(numberStated(16_219, "attendance 16,219"));
  assert.ok(!numberStated(72_198_500, "gate of $60 million"));
  assert.ok(!numberStated(4_600_000, "4.2 million buys"));
  assert.deepEqual(numbersIn("1,234 and 2.5 million").sort((a, b) => a - b), [2.5, 1234, 2_500_000]);
  assert.equal(squash("The “Fight of the Century” — $72,198,500!"), `the "fight of the century" - $72198500`);
  assert.equal(hostOf("https://www.espn.com/boxing/x"), "espn.com");
  assert.equal(hostOf("https://news.bbc.co.uk/a"), "bbc.co.uk");
  assert.equal(hostOf("https://boxing.nv.gov/x"), "nv.gov");
  assert.equal(hostOf("not a url"), "");
});

test("robots.txt: our group beats *, longest rule wins, Allow beats Disallow on a tie", () => {
  const r = parseRobots("User-agent: *\nDisallow: /private\nDisallow: /a\nAllow: /a/ok\nCrawl-delay: 4\n\nUser-agent: RingsideResearch\nDisallow: /only-us\n");
  assert.equal(robotsAllows(r, "/private/x"), true, "its own group replaces *");
  assert.equal(robotsAllows(r, "/only-us/x"), false);
  const star = parseRobots("User-agent: *\nDisallow: /private\nDisallow: /a\nAllow: /a/ok\nCrawl-delay: 4\n");
  assert.equal(robotsAllows(star, "/private/x"), false);
  assert.equal(robotsAllows(star, "/a/ok/page"), true);
  assert.equal(robotsAllows(star, "/a/nope"), false);
  assert.equal(robotsAllows(star, "/fine"), true);
  assert.equal(star.crawlDelay, 4);
  assert.equal(robotsAllows(parseRobots("User-agent: *\nDisallow: /*.pdf$\n"), "/x/y.pdf"), false);
  assert.equal(robotsAllows(parseRobots("User-agent: *\nDisallow:\n"), "/anything"), true, "an empty Disallow allows everything");
});

function fakeWeb(pages: Record<string, { status?: number; type?: string; body: string }>, log: string[] = []) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    log.push(url);
    const p = pages[url];
    if (!p) return new Response("", { status: 404 });
    return new Response(p.body, { status: p.status ?? 200, headers: { "content-type": p.type ?? "text/html; charset=utf-8" } });
  }) as typeof fetch;
  return { fetchImpl, log };
}
const mk = (pages: Parameters<typeof fakeWeb>[0], over: Partial<ConstructorParameters<typeof PoliteFetcher>[0]> = {}) => {
  const web = fakeWeb(pages);
  let clock = 0; const sleeps: number[] = [];
  const f = new PoliteFetcher({ contact: "research@example.org", fetchImpl: web.fetchImpl, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; }, delayMs: 3000, ...over });
  return { f, web, sleeps };
};

test("the polite fetcher identifies itself, obeys robots.txt, waits between requests and never works around a block", async () => {
  assert.throws(() => new PoliteFetcher({ contact: "" }), /contact/);
  assert.throws(() => new PoliteFetcher({ contact: "nobody" }), /contact/);

  const { f, web, sleeps } = mk({
    "https://news.example/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /secret\n" },
    "https://news.example/a": { body: "<html><nav>menu</nav><p>Gate: $5,000,000</p><script>x()</script></html>" },
    "https://news.example/b": { body: "<p>second</p>" },
    "https://news.example/secret/c": { body: "<p>nope</p>" },
    "https://walled.example/x": { status: 403, body: "denied" },
    "https://captcha.example/x": { body: "<html>Please complete the CAPTCHA to continue</html>" },
    "https://data.example/file": { type: "application/pdf", body: "%PDF" },
  });
  assert.match(f.userAgent, /^RingsideResearch\/0\.1 \(\+research@example\.org\)$/);
  const a = await f.get("https://news.example/a");
  assert.ok(a.ok && a.text.includes("Gate: $5,000,000") && !a.text.includes("menu") && !a.text.includes("x()"), "furniture and scripts are stripped");
  await f.get("https://news.example/b");
  assert.ok(sleeps.filter((s) => s > 0).length >= 2 && sleeps.every((s) => s <= 3000), "it waited between requests to the same host");
  const robots = await f.get("https://news.example/secret/c");
  assert.ok(!robots.ok && robots.reason === "robots");
  assert.ok(!web.log.includes("https://news.example/secret/c"), "a disallowed page is never requested");
  const walled = await f.get("https://walled.example/x");
  assert.ok(!walled.ok && walled.reason === "blocked");
  assert.equal(web.log.filter((u) => u === "https://walled.example/x").length, 1, "a 403 is not retried");
  const cap = await f.get("https://captcha.example/x");
  assert.ok(!cap.ok && cap.reason === "blocked", "a bot challenge is the end of it");
  const pdf = await f.get("https://data.example/file");
  assert.ok(!pdf.ok && pdf.reason === "unsupported");
  for (const url of ["https://boxrec.com/en/box-pro/1", "https://www.boxrec.com/x", "http://localhost/x", "http://127.0.0.1:3100/x", "http://192.168.1.5/x", "file:///etc/passwd", "ftp://x/y", "garbage"]) {
    const r = await f.get(url);
    assert.ok(!r.ok && ["blocked-host", "bad-url"].includes(r.reason), `${url} must be refused (${r.ok ? "fetched" : r.reason})`);
  }
  assert.ok(!web.log.some((u) => /boxrec|localhost|127\.0|192\.168/.test(u)), "refused hosts are never contacted, not even for robots.txt");
});

test("a robots.txt that answers 403 means stay away; a 404 means no restrictions; pages are cached", async () => {
  const away = mk({ "https://closed.example/robots.txt": { status: 403, body: "" }, "https://closed.example/a": { body: "<p>hi</p>" } });
  const r = await away.f.get("https://closed.example/a");
  assert.ok(!r.ok && r.reason === "robots");
  const open = mk({ "https://open.example/a": { body: "<p>hello</p>" } }, { cacheDir: `${process.env.TMPDIR ?? "/tmp"}/ringside-research-cache-${process.pid}` });
  const first = await open.f.get("https://open.example/a");
  assert.ok(first.ok && !first.fromCache);
  const second = await open.f.get("https://open.example/a");
  assert.ok(second.ok && second.fromCache, "the second read comes from the cache");
  assert.equal(open.web.log.filter((u) => u === "https://open.example/a").length, 1);
});

// ---------- the checker ----------
const MM = { name: "Mayweather vs Pacquiao", date: "2015-05-02", venue: "MGM Grand Garden Arena", city: "Las Vegas", fighters: ["Floyd Mayweather Jr.", "Manny Pacquiao"] };
const fact = (over: Partial<ResearchFact> = {}): ResearchFact => ({
  kind: "event_financials", event: MM, values: { gateUsd: 72_198_500 }, basis: "reported", source: "ESPN", sourceUrl: "https://espn.com/a",
  quote: "The fight drew a live gate of $72,198,500 at the MGM Grand.", ...over,
});
const pages = (map: Record<string, string>) => async (url: string): Promise<FetchOutcome> =>
  url in map ? { ok: true, url, text: map[url], fromCache: false, status: 200 } : { ok: false, url, reason: "http", detail: "HTTP 404" };
const PAGES = {
  "https://espn.com/a": "Story. The fight drew a live gate of $72,198,500 at the MGM Grand. More.",
  "https://forbes.com/b": "Forbes says the live gate was $72.2 million, a record.",
  "https://en.wikipedia.org/wiki/X": "It had a live gate of $72,198,500 according to the commission.",
  "https://nv.gov/c": "Official: total gate $72,198,500.",
  "https://other.com/d": "Gate receipts of $60 million were reported.",
};

test("claims are checked against the live page, and only figures two independent sources agree on are verified", async () => {
  const getPage = pages(PAGES);
  const run = (facts: ResearchFact[]) => checkFacts(facts, { getPage });

  const single = await run([fact()]);
  assert.equal(single[0].status, "single_source");

  const two = await run([fact(), fact({ source: "Forbes", sourceUrl: "https://forbes.com/b", quote: "the live gate was $72.2 million" })]);
  assert.deepEqual(two.map((c) => c.status), ["verified", "verified"]);
  assert.ok(two[0].reasons[0].includes("forbes.com"));

  const sameSite = await run([fact(), fact({ quote: "a live gate of $72,198,500" })]);
  assert.equal(sameSite[0].status, "single_source", "two pages from one site are one source");

  const wikiAlone = await run([fact({ source: "Wikipedia", sourceUrl: "https://en.wikipedia.org/wiki/X", quote: "a live gate of $72,198,500 according to the commission" })]);
  assert.equal(wikiAlone[0].status, "single_source");
  const wikiPlus = await run([fact({ source: "Wikipedia", sourceUrl: "https://en.wikipedia.org/wiki/X", quote: "a live gate of $72,198,500 according to the commission" }), fact()]);
  assert.deepEqual(wikiPlus.map((c) => c.status), ["verified", "verified"]);

  const official = await run([fact({ basis: "disclosed", source: "Nevada Athletic Commission", sourceUrl: "https://nv.gov/c", quote: "total gate $72,198,500" })]);
  assert.equal(official[0].status, "verified", "one official record is enough");
  const claimsOfficial = await run([fact({ basis: "disclosed", source: "A blog", sourceUrl: "https://espn.com/a" })]);
  assert.equal(claimsOfficial[0].status, "single_source", "calling yourself official does not make you official");

  const disagree = await run([fact(), fact({ source: "Other", sourceUrl: "https://other.com/d", quote: "Gate receipts of $60 million were reported", values: { gateUsd: 60_000_000 } })]);
  assert.deepEqual(disagree.map((c) => c.status), ["conflict", "conflict"]);
  assert.ok(disagree[0].reasons[0].includes("other.com"));

  const threeWay = await run([fact(), fact({ source: "Forbes", sourceUrl: "https://forbes.com/b", quote: "the live gate was $72.2 million" }), fact({ source: "Other", sourceUrl: "https://other.com/d", quote: "Gate receipts of $60 million were reported", values: { gateUsd: 60_000_000 } })]);
  assert.deepEqual(threeWay.map((c) => c.status), ["verified", "verified", "conflict"], "two agree, the outlier is flagged");
});

test("a claim that is not what the page says is never trusted", async () => {
  const getPage = pages(PAGES);
  const run = (f: ResearchFact) => checkFacts([f], { getPage }).then((r) => r[0]);
  assert.equal((await run(fact({ quote: "The fight drew a live gate of $99,000,000 at the MGM Grand." }))).status, "unconfirmed", "invented quote");
  assert.equal((await run(fact({ values: { gateUsd: 99_000_000 } }))).status, "unconfirmed", "the number is not in the quote");
  assert.match((await run(fact({ values: { gateUsd: 99_000_000 } }))).reasons[0], /gateUsd/);
  assert.equal((await run(fact({ sourceUrl: "https://gone.example/x" }))).status, "unconfirmed", "page cannot be read");
  assert.equal((await run(fact({ values: { gateUsd: 72_198_500, ticketsSold: 16_219 } }))).status, "unconfirmed", "every number must be in the quote, not only one");
  assert.equal((await run(fact({ kind: "broadcast", values: { broadcaster: "HBO", platform: "ppv" } }))).status, "unconfirmed", "broadcaster not named in the quote");
});

test("malformed claims are rejected before anything is fetched", () => {
  assert.deepEqual(shapeProblems(fact()), []);
  const p = (over: Partial<ResearchFact>) => shapeProblems(fact(over)).join(" | ");
  assert.match(p({ values: { gateUsd: "72 million" as never } }), /non-negative number/);
  assert.match(p({ values: { gateUsd: -1 } }), /non-negative/);
  assert.match(p({ values: { bogus: 1 } }), /unknown value/);
  assert.match(p({ values: {} }), /no values/);
  assert.match(p({ basis: "rumour" as never }), /basis/);
  assert.match(p({ source: "" }), /source is required/);
  assert.match(p({ sourceUrl: "ftp://x" }), /sourceUrl/);
  assert.match(p({ quote: "" }), /quote is required/);
  assert.match(p({ quote: "word ".repeat(90) }), /too long/);
  assert.match(p({ event: { ...MM, date: "May 2 2015" } }), /event needs/);
  assert.match(p({ event: { ...MM, fighters: ["only one"] } }), /event needs/);
  assert.match(p({ kind: "purse" }), /purse needs the fighter/);
  assert.match(p({ kind: "earning", event: undefined, fighter: "A B" }), /earning needs fighter and year/);
  assert.match(p({ kind: "broadcast", values: { broadcaster: "HBO", platform: "carrier-pigeon" } }), /platform/);
  assert.match(p({ kind: "nonsense" as never }), /unknown kind/);
  assert.equal(factId(fact()), factId(fact()));
  assert.notEqual(factId(fact()), factId(fact({ values: { gateUsd: 1 } })));
});

test("the extraction bot drops any fact whose quote is not on the page", async () => {
  const text = "Report: the card sold 16,219 tickets and the live gate was $72,198,500 in Las Vegas.";
  const answer = JSON.stringify({ facts: [
    { kind: "event_financials", values: { ticketsSold: 16219, gateUsd: 72198500 }, basis: "reported", source: "Test Wire", quote: "the card sold 16,219 tickets and the live gate was $72,198,500" },
    { kind: "event_financials", values: { ppvBuys: 4_600_000 }, basis: "reported", source: "Test Wire", quote: "the fight sold 4.6 million pay-per-view buys" },
  ] });
  const r = await extractFromPage({ ask: async () => `Here you go:\n${answer}`, text, url: "https://t.example/a", task: { event: MM, want: ["event_financials"] }, today: "2026-10-03" });
  assert.equal(r.facts.length, 1); assert.equal(r.dropped, 1, "the invented quote never reaches the checker");
  assert.equal(r.facts[0].sourceUrl, "https://t.example/a"); assert.equal(r.facts[0].agent, "bot"); assert.deepEqual(r.facts[0].event, MM);
  assert.deepEqual((await extractFromPage({ ask: async () => "not json at all", text, url: "u", task: { event: MM, want: [] } })).facts, []);
});

// ---------- matching to the database ----------
test("names: spellings of one boxer match, different boxers do not", () => {
  assert.equal(nameKey("Floyd Mayweather Jr."), "floyd mayweather");
  assert.ok(sameBoxer("Floyd Mayweather Jr.", "Floyd Mayweather"));
  assert.ok(sameBoxer("F. Mayweather", "Floyd Mayweather Jr."));
  assert.ok(sameBoxer("Saúl Álvarez", "Saul Alvarez"));
  assert.ok(!sameBoxer("Floyd Mayweather", "Floyd Patterson"));
  assert.ok(!sameBoxer("Manny Pacquiao", "Marco Pacquiao"));
  assert.ok(!sameBoxer("", "x"));
});

test("verified facts become money rows on the right bout; the rest are held or reported, never guessed", async () => {
  const { getDb } = await import("../lib/db");
  const db: DatabaseSync = await getDb();
  const row = db.prepare(`SELECT b.external_id bout, e.external_id event, e.date date, r.name rn, u.name un, e.name en FROM bouts b JOIN events e ON e.id=b.event_id
    JOIN boxers r ON r.id=b.red_id JOIN boxers u ON u.id=b.blue_id WHERE b.method IS NOT NULL LIMIT 1 OFFSET 40`).get() as { bout: string; event: string; date: string; rn: string; un: string; en: string };
  const ev = { name: row.en, date: row.date, fighters: [row.un, row.rn.replace(/\.$/, "")] }; // swapped order, still the same bout
  const checked = (over: Partial<ResearchFact>, status: "verified" | "single_source" | "conflict" = "verified") => ({ ...fact({ event: ev, ...over }), id: "x", host: "espn.com", status, reasons: [] });
  const m = matchFacts(db, [
    checked({ values: { gateUsd: 1_000_000, ticketsSold: 900 } }),
    checked({ kind: "purse", fighter: row.rn, values: { totalUsd: 500_000 }, basis: "disclosed" }), // espn.com is not official: downgraded
    checked({ kind: "broadcast", values: { broadcaster: "TestNet", platform: "ppv", region: "United States" }, quote: "TestNet aired it" }),
    checked({ values: { gateUsd: 2 } }, "single_source"),
    checked({ values: { gateUsd: 3 } }, "conflict"),
    checked({ event: { ...ev, date: "1999-01-01" }, values: { gateUsd: 4 } }),
    checked({ kind: "purse", fighter: "Nobody Atall", values: { totalUsd: 5 } }),
    checked({ kind: "earning", event: undefined, fighter: row.rn, year: 2024, values: { totalUsd: 12_000_000, ringUsd: 10_000_000 } }),
  ], { today: "2026-10-03" });
  assert.equal(m.rows.financials.length, 1); assert.equal(m.rows.financials[0].eventExternalId, row.event);
  assert.equal(m.rows.purses.length, 1); assert.equal(m.rows.purses[0].boutExternalId, row.bout);
  assert.equal(m.rows.purses[0].basis, "reported", "a non-official site cannot make a figure official");
  assert.match(m.rows.purses[0].note ?? "", /non-official/);
  assert.equal(m.rows.broadcasts[0].broadcaster, "TestNet");
  assert.equal(m.rows.earnings.length, 1);
  assert.equal(m.held.length, 2, "single-source and conflicting facts are held back");
  assert.equal(m.unmatched.length, 2); assert.ok(m.unmatched.some((u) => /no bout/.test(u.reason)) && m.unmatched.some((u) => /not in that bout|no bout/.test(u.reason)));
  const withSingle = matchFacts(db, [checked({ values: { gateUsd: 2 } }, "single_source")], { allowSingleSource: true });
  assert.equal(withSingle.rows.financials.length, 1); assert.match(withSingle.rows.financials[0].note ?? "", /single source/);
  const official = matchFacts(db, [{ ...checked({ values: { gateUsd: 9 }, basis: "disclosed", source: "Commission" }), host: "nv.gov" }]);
  assert.equal(official.rows.financials[0].basis, "disclosed", "an official host keeps its basis");

  // and the rows are accepted by the money validator and the database
  const { ingestMoney } = await import("../lib/ingest-money");
  const r = ingestMoney(db, m.rows, { label: "research-test" });
  assert.deepEqual(r.written, { financials: 1, purses: 1, broadcasts: 1, earnings: 1 });
  assert.deepEqual(r.dropped, {});
});

// ---------- settling conflicts: lists and recorded decisions ----------
const DECISION: Decision = { action: "exclude", claims: ["x"], why: "outlier", reason: "One source against two independent ones, and the page itself says so.", evidence: ["https://example.com/evidence"], decidedBy: "tester", date: "2026-10-03" };
const THREE = () => [
  fact(), fact({ source: "Forbes", sourceUrl: "https://forbes.com/b", quote: "the live gate was $72.2 million" }),
  fact({ source: "Other", sourceUrl: "https://other.com/d", quote: "Gate receipts of $60 million were reported", values: { gateUsd: 60_000_000 } }),
];

test("decisions must say why, with evidence, and name claims that exist", () => {
  assert.deepEqual(decisionProblems(DECISION), []);
  assert.ok(decisionProblems({ ...DECISION, reason: "bad" }).some((p) => /reason/.test(p)), "a reason of a word or two is not a reason");
  assert.ok(decisionProblems({ ...DECISION, evidence: [] }).some((p) => /evidence/.test(p)));
  assert.ok(decisionProblems({ ...DECISION, evidence: ["not a link"] }).some((p) => /evidence/.test(p)));
  assert.ok(decisionProblems({ ...DECISION, why: "because" as never }).some((p) => /why/.test(p)));
  assert.ok(decisionProblems({ ...DECISION, claims: [] }).some((p) => /claims/.test(p)));
  assert.ok(decisionProblems({ ...DECISION, action: "set" as never }).some((p) => /action/.test(p)), "there is no way to put a number in by decision");
  assert.ok(decisionProblems({ ...DECISION, date: "yesterday" }).some((p) => /date/.test(p)));
  assert.deepEqual(staleDecisions([DECISION, { ...DECISION, claims: ["x", "gone"] }], [{ id: "x" }]).map((s) => s.missing), [["gone"]]);
});

test("an excluded outlier leaves the others to be judged as usual, and is never published", async () => {
  const getPage = pages(PAGES);
  const before = await checkFacts(THREE(), { getPage });
  const outlier = before[2];
  assert.equal(outlier.status, "conflict");
  const after = await checkFacts(THREE(), { getPage, decisions: [{ ...DECISION, claims: [outlier.id] }] });
  assert.deepEqual(after.map((c) => c.status), ["verified", "verified", "excluded"]);
  assert.equal(after[2].decision?.why, "outlier");
  assert.match(after[2].reasons[0], /excluded \(outlier\)/);
  assert.deepEqual(after[2].fields, { gateUsd: "excluded" });

  // excluding does not conjure agreement: with only one other source left, that one is merely a single source
  const lone = await checkFacts(THREE().slice(0, 1).concat(THREE().slice(2)), { getPage, decisions: [{ ...DECISION, claims: [outlier.id] }] });
  assert.deepEqual(lone.map((c) => c.status), ["single_source", "excluded"]);

  // a decision about a claim that was edited no longer matches it
  const edited = THREE(); edited[2] = { ...edited[2], values: { gateUsd: 61_000_000 }, quote: "Gate receipts of $60 million were reported" };
  const stale = await checkFacts(edited, { getPage, decisions: [{ ...DECISION, claims: [outlier.id] }] });
  assert.equal(stale[2].status === "excluded", false);
  assert.equal(staleDecisions([{ ...DECISION, claims: [outlier.id] }], stale).length, 1);

  const m = matchFacts(await (await import("../lib/db")).getDb(), after, { allowSingleSource: true });
  assert.ok(m.held.some((h) => h.status === "excluded"), "excluded claims are held back even when single sources are allowed");
});

test("each value has its own status: a disputed value does not hold back the others on the same claim", async () => {
  const both = (over: Partial<ResearchFact>) => fact({ values: { gateUsd: 72_198_500, ticketsSold: 16_219 }, quote: "live gate of $72,198,500 and attendance 16,219", ...over });
  const pg2 = pages({ ...{ "https://a.com/1": "A: live gate of $72,198,500 and attendance 16,219.", "https://b.com/1": "B: live gate of $72,198,500 and attendance 16,219." }, "https://c.com/1": "C: live gate of $72,198,500 and attendance 9,000." });
  const r2 = await checkFacts([
    both({ source: "A", sourceUrl: "https://a.com/1" }), both({ source: "B", sourceUrl: "https://b.com/1" }),
    both({ source: "C", sourceUrl: "https://c.com/1", values: { gateUsd: 72_198_500, ticketsSold: 9_000 }, quote: "live gate of $72,198,500 and attendance 9,000" }),
  ], { getPage: pg2 });
  assert.deepEqual(r2[2].fields, { gateUsd: "verified", ticketsSold: "conflict" });
  assert.equal(r2[2].status, "conflict", "the claim as a whole is still flagged");
  assert.deepEqual(r2[0].fields, { gateUsd: "verified", ticketsSold: "verified" });

  // promotion: the verified value goes through, the other is dropped from the row, not the whole claim
  const db = await (await import("../lib/db")).getDb();
  const row = db.prepare(`SELECT e.name en, e.date date, r.name rn, u.name un FROM bouts b JOIN events e ON e.id=b.event_id JOIN boxers r ON r.id=b.red_id JOIN boxers u ON u.id=b.blue_id WHERE b.method IS NOT NULL LIMIT 1 OFFSET 41`).get() as { en: string; date: string; rn: string; un: string };
  const ev = { name: row.en, date: row.date, fighters: [row.rn, row.un] };
  const split = { ...fact({ event: ev, values: { gateUsd: 5_000_000, ticketsSold: 100 } }), id: "s", host: "espn.com", status: "conflict" as const, reasons: [], fields: { gateUsd: "verified" as const, ticketsSold: "conflict" as const } };
  const m = matchFacts(db, [split], { today: "2026-10-03" });
  assert.equal(m.rows.financials.length, 1);
  assert.equal(m.rows.financials[0].gateUsd, 5_000_000);
  assert.equal(m.rows.financials[0].ticketsSold, undefined, "the conflicting value is not published");
  const allBad = matchFacts(db, [{ ...split, fields: { gateUsd: "conflict" as const, ticketsSold: "excluded" as const } }]);
  assert.equal(allBad.rows.financials.length, 0); assert.equal(allBad.held.length, 1);
});

test("earnings are only compared within one list, and one list is one row however many outlets repeat it", async () => {
  const E = (over: Partial<ResearchFact>): ResearchFact => ({ kind: "earning", fighter: "Test Boxer", year: 2024, list: "Forbes 2024 list", values: { totalUsd: 50_000_000 }, basis: "reported", source: "A", sourceUrl: "https://a.com/e", quote: "Test Boxer made $50 million", ...over });
  const pg = pages({ "https://a.com/e": "Test Boxer made $50 million.", "https://b.com/e": "Test Boxer made $50 million this year.", "https://c.com/e": "Test Boxer made $147 million.", "https://d.com/e": "Test Boxer made $147 million in 2024." });
  const facts = [
    E({}), E({ source: "B", sourceUrl: "https://b.com/e", quote: "Test Boxer made $50 million" }),
    E({ list: "Sportico 2024 list", source: "C", sourceUrl: "https://c.com/e", values: { totalUsd: 147_000_000 }, quote: "Test Boxer made $147 million" }),
    E({ list: "Sportico 2024 list", source: "D", sourceUrl: "https://d.com/e", values: { totalUsd: 147_000_000 }, quote: "Test Boxer made $147 million" }),
  ];
  const r = await checkFacts(facts, { getPage: pg });
  assert.deepEqual(r.map((c) => c.status), ["verified", "verified", "verified", "verified"], "two lists, two numbers, no conflict");
  const noList = await checkFacts(facts.map((f) => ({ ...f, list: undefined })), { getPage: pg });
  assert.ok(noList.some((c) => c.status === "conflict"), "without the list the same figures disagree (the old behaviour)");
  assert.ok(shapeProblems({ ...fact(), list: "Forbes" }).some((p) => /list/.test(p)), "list is for earnings only");
  assert.ok(shapeProblems(E({ list: " " })).some((p) => /list/.test(p)));

  const db = await (await import("../lib/db")).getDb();
  const who = db.prepare("SELECT name FROM boxers LIMIT 1").get() as { name: string };
  const m = matchFacts(db, r.map((c) => ({ ...c, fighter: who.name })), { today: "2026-10-03" });
  assert.equal(m.rows.earnings.length, 2, "one row per list");
  assert.deepEqual(m.rows.earnings.map((e) => e.source).sort(), ["Forbes 2024 list", "Sportico 2024 list"]);
  const { ingestMoney } = await import("../lib/ingest-money");
  const ing = ingestMoney(db, m.rows, { label: "research-list-test" });
  assert.deepEqual(ing.dropped, {}, "no duplicate-earning errors");
});

test("the committed research is settled: every decision is well formed and still matches a claim, and no conflict is left open", async () => {
  const fs = await import("node:fs");
  const lines = (f: string) => fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const decisions = lines("data/research/decisions.jsonl") as Decision[];
  const checked = lines("data/research/checked.jsonl") as { id: string; status: string; decision?: unknown }[];
  assert.ok(decisions.length > 0);
  decisions.forEach((d, i) => assert.deepEqual(decisionProblems(d), [], `decision ${i + 1}`));
  assert.deepEqual(staleDecisions(decisions, checked), [], "a decision names a claim that no longer exists (edited? run the check again)");
  assert.deepEqual(checked.filter((c) => c.status === "conflict").map((c) => c.id), [], "a conflict is open: gather evidence and record a decision (docs/research.md)");
  for (const c of checked.filter((x) => x.status === "excluded")) assert.ok(c.decision, "an excluded claim carries its decision");
});

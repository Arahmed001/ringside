import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeBoxer, miniFeed, tempDb } from "./helpers";
import { sanitizeFeed } from "../lib/validate";

const cleanup = tempDb("money");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let money: typeof import("../lib/money");
before(async () => { w = await (await import("../lib/world")).getWorld(); money = await import("../lib/money"); });

const TODAY = "2026-10-03";
const base = () => {
  const f = miniFeed();
  f.boxers.push(makeBoxer("C"));
  return f;
};
const issues = (mutate: (f: ReturnType<typeof base>) => void) => { const f = base(); mutate(f); return sanitizeFeed(f, { today: TODAY }); };
const codes = (r: ReturnType<typeof sanitizeFeed>, sev?: string) => r.issues.filter((i) => !sev || i.severity === sev).map((i) => i.code);
const good = { basis: "reported" as const, source: "Test Wire", sourceUrl: "https://example.com/a" };

test("money rows need a basis and a named source, and must point at things that exist", () => {
  const ok = issues((f) => {
    f.financials.push({ eventExternalId: "E1", gateUsd: 5_000_000, ticketsSold: 9000, capacity: 10000, ...good });
    f.purses.push({ boutExternalId: "E1-1", boxerExternalId: "A", totalUsd: 2_000_000, ...good });
    f.broadcasts.push({ eventExternalId: "E1", broadcaster: "TestNet", platform: "ppv", region: "United States", viewersAvg: 1000, viewersPeak: 1500, ...good });
    f.earnings.push({ boxerExternalId: "A", year: 2025, totalUsd: 9_000_000, ringUsd: 8_000_000, offRingUsd: 1_000_000, ...good });
  });
  assert.deepEqual(codes(ok, "error"), []);
  assert.equal(ok.feed.financials.length + ok.feed.purses.length + ok.feed.broadcasts.length + ok.feed.earnings.length, 4);

  const noSource = issues((f) => { f.purses.push({ boutExternalId: "E1-1", boxerExternalId: "A", totalUsd: 1, basis: "reported", source: "  " }); });
  assert.ok(codes(noSource, "error").includes("missing_source") && noSource.feed.purses.length === 0, "an unsourced figure is not published");
  const badBasis = issues((f) => { f.purses.push({ boutExternalId: "E1-1", boxerExternalId: "A", totalUsd: 1, basis: "rumoured" as never, source: "x" }); });
  assert.ok(codes(badBasis, "error").includes("bad_basis") && badBasis.feed.purses.length === 0);
  const badRef = issues((f) => {
    f.purses.push({ boutExternalId: "NOPE", boxerExternalId: "A", totalUsd: 1, ...good });
    f.financials.push({ eventExternalId: "NOPE", gateUsd: 1, ...good });
    f.broadcasts.push({ eventExternalId: "NOPE", broadcaster: "X", platform: "ppv", ...good });
    f.earnings.push({ boxerExternalId: "NOPE", year: 2020, totalUsd: 1, ...good });
  });
  assert.equal(codes(badRef, "error").filter((c) => c === "bad_reference").length, 4);
  const neg = issues((f) => { f.financials.push({ eventExternalId: "E1", gateUsd: -5, ...good }); f.purses.push({ boutExternalId: "E1-1", boxerExternalId: "A", ...good }); });
  assert.ok(codes(neg, "error").includes("negative_amount") && codes(neg, "error").includes("empty_purse"));
  const dup = issues((f) => { for (let i = 0; i < 2; i++) f.purses.push({ boutExternalId: "E1-1", boxerExternalId: "A", totalUsd: 5, ...good }); });
  assert.ok(codes(dup, "error").includes("dup_purse") && dup.feed.purses.length === 1);
  const badPlatform = issues((f) => { f.broadcasts.push({ eventExternalId: "E1", broadcaster: "X", platform: "carrier-pigeon" as never, ...good }); });
  assert.ok(codes(badPlatform, "error").includes("bad_platform"));
  const futureYear = issues((f) => { f.earnings.push({ boxerExternalId: "A", year: 2031, totalUsd: 1, ...good }); });
  assert.ok(codes(futureYear, "error").includes("bad_year"));
});

test("implausible or inconsistent money is flagged but kept, never corrected", () => {
  const r = issues((f) => {
    f.financials.push({ eventExternalId: "E1", ticketsSold: 12000, capacity: 10000, ppvBuys: 1_000_000, ppvPriceUsd: 70, ppvRevenueUsd: 40_000_000, gateUsd: 900, ...good });
    f.purses.push({ boutExternalId: "E1-1", boxerExternalId: "C", totalUsd: 900_000_000, guaranteedUsd: 950_000_000, ...good });
    f.broadcasts.push({ eventExternalId: "E1", broadcaster: "X", platform: "streaming", viewersAvg: 2000, viewersPeak: 1000, ...good });
  });
  const w2 = codes(r, "warning");
  for (const c of ["tickets_over_capacity", "ppv_revenue_mismatch", "implausible_ticket_price", "purse_not_in_bout", "implausible_purse", "purse_total_below_guarantee", "peak_below_average"]) assert.ok(w2.includes(c), `expected ${c}, got ${w2.join(",")}`);
  assert.deepEqual([r.feed.financials.length, r.feed.purses.length, r.feed.broadcasts.length], [1, 1, 1], "all kept");
  const noUrl = issues((f) => { f.purses.push({ boutExternalId: "E1-1", boxerExternalId: "A", totalUsd: 5, basis: "estimated", source: "Someone" }); });
  assert.ok(codes(noUrl, "info").includes("no_source_url") && noUrl.feed.purses.length === 1);
});

test("the strongest source wins per figure, and each figure keeps its own source", () => {
  const p = (basis: "disclosed" | "reported" | "estimated", retrievedAt: string | null, source: string = basis) => ({ basis, source, sourceUrl: null, retrievedAt, note: null });
  assert.equal(money.best([{ ...p("estimated", "2026-01-01") }, { ...p("reported", "2020-01-01") }, { ...p("disclosed", "2019-01-01") }])!.basis, "disclosed");
  assert.equal(money.best([{ ...p("reported", "2020-01-01", "old") }, { ...p("reported", "2024-01-01", "new") }])!.source, "new", "newest reading breaks a tie");
  assert.equal(money.best([]), undefined);

  const eventId = [...w.financialsByEvent.keys()][0];
  const original = w.financialsByEvent.get(eventId)!;
  const mk = (over: Partial<(typeof original)[number]>) => ({ ...original[0], gateUsd: null, ticketsSold: null, capacity: null, siteFeeUsd: null, ppvBuys: null, ppvPriceUsd: null, ppvRevenueUsd: null, sponsorshipUsd: null, ...over });
  const fake: World = { ...w, financialsByEvent: new Map([[eventId, [
    mk({ basis: "estimated", source: "Analyst", gateUsd: 111, ppvBuys: 222 }),
    mk({ basis: "disclosed", source: "Commission", gateUsd: 333 }),
  ]]]) };
  const m = money.eventMoney(fake, eventId);
  assert.equal(m.fields.gateUsd!.value, 333); assert.equal(m.fields.gateUsd!.prov.source, "Commission");
  assert.equal(m.fields.ppvBuys!.value, 222); assert.equal(m.fields.ppvBuys!.prov.source, "Analyst", "a figure only the estimate has still shows, labelled as an estimate");
});

test("demo money is coherent: tickets within capacity, PPV revenue from buys x price, purses within their parts, careers add up", () => {
  const cov = money.moneyCoverage(w);
  assert.ok(cov.withFinancials > 100 && cov.purses > 1000 && cov.basis.disclosed > 0 && cov.basis.reported > 0 && cov.basis.estimated > 0, "all three bases exist to show");
  for (const rows of w.financialsByEvent.values()) for (const f of rows) {
    if (f.ticketsSold !== null && f.capacity !== null) assert.ok(f.ticketsSold <= f.capacity);
    if (f.ppvBuys !== null && f.ppvPriceUsd !== null && f.ppvRevenueUsd !== null) assert.ok(Math.abs(f.ppvRevenueUsd - f.ppvBuys * f.ppvPriceUsd) / f.ppvRevenueUsd < 0.01);
  }
  for (const rows of w.pursesByBout.values()) for (const p of rows) if (p.guaranteedUsd !== null) assert.ok(p.guaranteedUsd + (p.bonusUsd ?? 0) <= p.totalUsd + 1 && p.totalUsd >= p.guaranteedUsd);

  const star = money.topEarners(w, 1)[0];
  const m = money.careerMoney(w, star.boxer.id)!;
  assert.equal(m.total, star.total);
  assert.equal(m.fights, star.fights);
  assert.ok(m.biggest!.purse.totalUsd <= m.total && m.disclosedShare >= 0 && m.disclosedShare <= 1);
  assert.equal(m.byYear.reduce((s, y) => s + y.ring, 0) > 0, true);
  assert.equal(money.careerMoney(w, -1), null);
});

test("leaderboards are sorted, complete and consistent with the raw rows", () => {
  const gates = money.topGates(w, 5), ppv = money.topPpv(w, 5), purses = money.topPurses(w, 5), earners = money.topEarners(w, 5);
  for (const list of [gates.map((g) => g.value), ppv.map((g) => g.value), purses.map((p) => p.purse.totalUsd), earners.map((e) => e.total)]) assert.deepEqual(list, [...list].sort((a, b) => b - a));
  const maxPurse = Math.max(...[...w.pursesByBout.values()].flat().map((p) => p.totalUsd));
  assert.equal(purses[0].purse.totalUsd, maxPurse);
  const maxGate = Math.max(...[...w.financialsByEvent.values()].flat().map((f) => f.gateUsd ?? 0));
  assert.equal(gates[0].value, maxGate);
  assert.ok(gates.every((g) => !g.event.upcoming), "upcoming cards have no takings");
  const yr = money.topEarners(w, 3, 2024);
  assert.ok(yr.length > 0 && yr[0].total <= earners[0].total * 10);
  assert.equal(money.topGates(w, 5), money.topGates(w, 5), "memoised per world");
  const years = money.revenueByYear(w);
  assert.equal(years.reduce((s, y) => s + y.gate, 0), [...w.financialsByEvent.values()].reduce((s, rows) => s + (money.eventMoney(w, rows[0].eventId).fields.gateUsd?.value ?? 0), 0));
  const bc = money.broadcasterTable(w);
  assert.ok(bc.length >= 3 && bc.every((b) => b.events > 0));
});

test("compact US-dollar formatting", () => {
  assert.equal(money.usd(23_861_000), "$23.9M");
  assert.equal(money.usd(145_480_000), "$145M");
  assert.equal(money.usd(1_200_000), "$1.2M");
  assert.equal(money.usd(840_000), "$840K");
  assert.equal(money.usd(2_880_000_000), "$2.88B");
  assert.equal(money.usd(7500), "$7,500");
  assert.equal(money.compact(2_430_000), "2.43M");
});

test("ingestMoney adds figures to an existing database, replaces per source, and reports what it dropped", async () => {
  const { getDb } = await import("../lib/db");
  const { ingestMoney } = await import("../lib/ingest-money");
  const db = await getDb();
  const row = db.prepare("SELECT b.external_id bout, r.external_id red, e.external_id event FROM purses p JOIN bouts b ON b.id=p.bout_id JOIN boxers r ON r.id=p.boxer_id AND r.id=b.red_id JOIN events e ON e.id=b.event_id WHERE b.method IS NOT NULL LIMIT 1 OFFSET 10").get() as { bout: string; red: string; event: string };
  const rows = {
    financials: [{ eventExternalId: row.event, gateUsd: 1_234_000, basis: "disclosed" as const, source: "Research Test", sourceUrl: "https://example.com/gate" }],
    purses: [{ boutExternalId: row.bout, boxerExternalId: row.red, totalUsd: 9_999_000, basis: "disclosed" as const, source: "Research Test", sourceUrl: "https://example.com/purse", retrievedAt: "2026-10-01" },
             { boutExternalId: "no-such-bout", boxerExternalId: row.red, totalUsd: 1, basis: "reported" as const, source: "Research Test" }],
    broadcasts: [], earnings: [], officialRankings: [],
  };
  const r1 = ingestMoney(db, rows, { label: "research-test" });
  assert.deepEqual(r1.written, { financials: 1, purses: 1, broadcasts: 0, earnings: 0, weighIns: 0 });
  assert.equal(r1.dropped.purse, 1);
  assert.ok(r1.issues.some((i) => i.code === "bad_reference"));
  ingestMoney(db, rows, { label: "research-test" }); // again: replaced, not duplicated
  const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  assert.equal(count("SELECT COUNT(*) c FROM purses WHERE source = 'Research Test'"), 1);
  assert.equal(count("SELECT COUNT(*) c FROM event_financials WHERE source = 'Research Test'"), 1);
  assert.ok(count("SELECT COUNT(*) c FROM purses WHERE source != 'Research Test'") > 1000, "other sources' figures survive");
  assert.ok(count("SELECT COUNT(*) c FROM ingest_runs WHERE provider = 'research-test'") === 2, "each run is recorded");

  const { invalidateWorld, getWorld } = await import("../lib/world");
  invalidateWorld();
  const w2 = await getWorld();
  const boutId = (db.prepare("SELECT id FROM bouts WHERE external_id = ?").get(row.bout) as { id: number }).id;
  const redId = (db.prepare("SELECT id FROM boxers WHERE external_id = ?").get(row.red) as { id: number }).id;
  const purses = w2.pursesByBout.get(boutId)!.filter((p) => p.boxerId === redId);
  assert.ok(purses.length >= 2, "two sources for the same purse are both kept");
  assert.equal(money.boutPurses(w2, boutId).get(redId)!.source, "Research Test", "an official figure read more recently beats the older ones");
  assert.equal(money.eventMoney(w2, (db.prepare("SELECT id FROM events WHERE external_id = ?").get(row.event) as { id: number }).id).rows.length >= 2, true);
});

test("the demo league itself is untouched by money and belts: only title labels differ from the original league", async () => {
  const { demoProvider } = await import("../lib/providers/demo");
  const p = demoProvider(new Date("2026-10-03"));
  const h = crypto.createHash("sha1");
  for (const k of ["fetchBoxers", "fetchEvents", "fetchBouts", "fetchPeople", "fetchOrgs", "fetchStints", "fetchWeighIns", "fetchOfficials", "fetchScorecards", "fetchCorners", "fetchPunchStats"] as const) {
    let rows = (await (p[k] as () => Promise<unknown[]>)()) as Record<string, unknown>[];
    if (k === "fetchBouts") rows = rows.map((b) => ({ ...b, title: null, titleOrgExternalId: undefined, titleVacant: undefined })); // belts are applied by their own pass, after every result exists; this hash is what the generator before the belts pass produced with its titles removed
    h.update(JSON.stringify(rows));
  }
  assert.equal(h.digest("hex"), "e8bd955d216fb2d852a7bb9308ef820867c13f76");
});

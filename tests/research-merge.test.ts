import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";
import { matchFacts } from "../lib/research/match";
import type { CheckedFact } from "../lib/research/types";

const cleanup = tempDb("research-merge");
after(cleanup);

test("two claims from one site about one card are one row, because the database keeps one row per card and source", async () => {
  const db: DatabaseSync = await (await import("../lib/db")).getDb();
  const row = db.prepare(`SELECT e.name en, e.date date, r.name rn, u.name un FROM bouts b JOIN events e ON e.id=b.event_id JOIN boxers r ON r.id=b.red_id JOIN boxers u ON u.id=b.blue_id LIMIT 1`).get() as { en: string; date: string; rn: string; un: string };
  const ev = { name: row.en, date: row.date, fighters: [row.rn, row.un] };
  const fact = (source: string, values: Record<string, number>, kind: CheckedFact["kind"] = "event_financials", extra: Partial<CheckedFact> = {}): CheckedFact => ({
    kind, event: ev, values, basis: "reported", source, sourceUrl: `https://${source.toLowerCase().replace(/\W/g, "")}.com/a${Object.keys(values)[0]}`, quote: "q", accessedAt: "2026-10-03", id: `${source}${Object.keys(values)[0]}`, host: "x.com", status: "verified", reasons: [], ...extra } as CheckedFact);
  const facts = [fact("ESPN", { gateUsd: 1_000_000, ticketsSold: 900 }), fact("ESPN", { ppvBuys: 500_000 }), fact("ESPN", { ppvBuys: 600_000 }), fact("ABC News", { ppvBuys: 500_000 }),
    fact("ESPN", { guaranteedUsd: 100_000 }, "purse", { fighter: row.rn }), fact("ESPN", { bonusUsd: 5_000 }, "purse", { fighter: row.rn })];
  const m = matchFacts(db, facts, { today: "2026-10-03" });
  assert.equal(m.rows.financials.length, 2, "ESPN's three claims are one row, ABC's another");
  const espn = m.rows.financials.find((f) => f.source === "ESPN")!;
  assert.deepEqual([espn.gateUsd, espn.ticketsSold, espn.ppvBuys], [1_000_000, 900, 500_000], "the figures join, and where one source gave two numbers the first stands");
  assert.equal(m.rows.purses.length, 1);
  assert.deepEqual([m.rows.purses[0].guaranteedUsd, m.rows.purses[0].bonusUsd], [100_000, 5_000]);
});

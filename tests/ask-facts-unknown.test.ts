import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBoxer, miniFeed, tempDb } from "./helpers";
import { makeT, tEn } from "../lib/i18n/t";

/** A fighter the feed says nothing about (no height, reach, birth year or stance): a question about one of those facts is told so, and nothing is made up. */
const cleanup = tempDb("ask-facts-unknown");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-afu-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });
const AR = JSON.parse(fs.readFileSync(path.join(process.cwd(), "i18n", "ar.json"), "utf8"));

test("where the data does not give the fact, the answer says so, in English and in Arabic", async () => {
  const feed = miniFeed();
  feed.boxers = [makeBoxer("u1", "Lightweight", { name: "Pablo Quintana", heightCm: null, reachCm: null, birthYear: null, stance: null }), makeBoxer("u2", "Lightweight", { name: "Diego Ramos" }), makeBoxer("u3", "Lightweight", { name: "Mateo Vidal" })];
  // Diego: a win by knockout, a loss and a draw against Mateo; three more cards ahead (one called off, listed after the earlier of the other two); a gym and a trainer who are gone and ones who are current
  const ev = (id: string, name: string, date: string, status?: string) => ({ externalId: id, name, date, venue: "Arena", city: "Reno", country: "United States", ...(status ? { status } : {}) }) as never;
  feed.events = [ev("Ea", "Old Night", "2025-03-01"), ev("Eb", "Second Night", "2025-06-01"), ev("Ec", "Third Night", "2025-09-01"), ev("Ed", "Called Off Night", "2026-10-20", "cancelled"), ev("Ee", "Winter Night", "2026-12-01"), ev("Ef", "Autumn Night", "2026-11-15")];
  const bout = (id: string, e: string, winner: string | null, method: "KO" | "UD" | "DRAW" | null) => ({ externalId: id, eventExternalId: e, redExternalId: "u2", blueExternalId: "u3", weightClass: "Lightweight", rounds: 12, winnerExternalId: winner, method, endRound: method ? (method === "KO" ? 3 : 12) : null, title: null, position: 0 });
  feed.bouts = [bout("ba", "Ea", "u2", "KO"), bout("bb", "Eb", "u3", "UD"), bout("bc", "Ec", null, "DRAW"), bout("bd", "Ed", null, null), bout("be", "Ee", null, null), bout("bf", "Ef", null, null)];
  feed.orgs = [...feed.orgs, { externalId: "G2", name: "Iron Works", kind: "gym" }];
  feed.stints = [
    { boxerExternalId: "u2", role: "gym", orgExternalId: "G1", start: "2020-01-01", end: "2024-12-31", source: "test" }, { boxerExternalId: "u2", role: "gym", orgExternalId: "G2", start: "2025-01-01", end: null, source: "test" },
    { boxerExternalId: "u2", role: "head_trainer", personExternalId: "T1", start: "2020-01-01", end: "2024-12-31", source: "test" }, { boxerExternalId: "u2", role: "head_trainer", personExternalId: "T2", start: "2025-01-01", end: null, source: "test" },
  ];
  feed.weighIns = []; feed.scorecards = []; feed.officials = []; feed.corners = []; feed.punches = [];
  const file = path.join(dir, "unknown.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  const wu = await (await import("../lib/world")).getWorld();
  const ask = (await import("../lib/ask")).askData;
  {
    const run = async (q: string, locale: "en" | "ar" = "en", table: Record<string, string> = {}) => (await ask(q, { w: wu, t: locale === "en" ? tEn : makeT("ar", AR), names: table })).answer;
    assert.equal(await run("how tall is Pablo Quintana"), "The data does not give a height for Pablo Quintana.");
    assert.equal(await run("what is Pablo Quintana's reach"), "The data does not give a reach for Pablo Quintana.");
    assert.equal(await run("how old is Pablo Quintana"), "The data does not give an age for Pablo Quintana.");
    assert.equal(await run("is Pablo Quintana a southpaw"), "The data does not give a stance for Pablo Quintana.");
    assert.equal(await run("who trains Pablo Quintana"), "The data has no current head trainer for Pablo Quintana.");
    assert.equal(await run("which gym does Pablo Quintana train at"), "The data has no current gym for Pablo Quintana.");
    assert.equal(await run("when does Pablo Quintana fight next"), "No upcoming fight is scheduled for Pablo Quintana.");
    assert.equal(await run("when did Pablo Quintana last fight"), "Pablo Quintana has no completed fights on record.");
    assert.equal(await run("does Pablo Quintana hold a belt"), "Pablo Quintana holds no current belt.");
    // facts worked out from a record made by hand: three fights (a knockout win, a loss, a draw), the earliest of two cards ahead, the current gym and trainer
    assert.equal(await run("what is Diego Ramos's record"), "Diego Ramos has had 3 fights: 1-1-1.");
    assert.equal(await run("how many knockouts does Diego Ramos have"), "Diego Ramos has 1 knockouts in 1 wins (100%).");
    assert.equal(await run("which gym does Diego Ramos train at"), "Diego Ramos trains at Iron Works.");
    assert.equal(await run("who trains Diego Ramos"), "Diego Ramos's head trainer is Trainer Two.");
    assert.equal(await run("when does Diego Ramos fight next"), "Diego Ramos's next fight is against Mateo Vidal on Nov 15, 2026.", "the earliest card that is on: not the called-off one, and not the later one listed first");
    assert.match(await run("when did Diego Ramos last fight"), /^Diego Ramos's last fight was on Sep 1, 2025: a draw against Mateo Vidal \(/);
    // in Arabic, with the name as the site writes it
    const table = { "Pablo Quintana": "بابلو كوينتانا" };
    assert.match(await run("كم عمر بابلو كوينتانا", "ar", table), /لا تتضمن البيانات العمر لـ/);
    assert.match(await run("ما هو طول بابلو كوينتانا", "ar", table), /لا تتضمن البيانات الطول لـ/);
  }
});


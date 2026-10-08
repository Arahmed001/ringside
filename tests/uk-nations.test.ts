import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { miniFeed, tempDb } from "./helpers";

const cleanup = tempDb("uk-nations");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-uk-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });

test("the United Kingdom page counts the fighters and cards of England, Scotland, Wales and Northern Ireland as well as its own; each nation keeps its page with only its own; the nations are listed on the United Kingdom's (round 133)", async () => {
  const feed = miniFeed();
  const base = feed.boxers[0];
  const mk = (id: string, country: string) => ({ ...base, externalId: id, name: `Fighter ${id}`, country });
  feed.boxers = [mk("e", "England"), mk("s", "Scotland"), mk("u", "United Kingdom"), mk("m", "Mexico")];
  const ev = feed.events[0];
  feed.events = ["England", "Wales", "United Kingdom", "Mexico"].map((country, i) => ({ ...ev, externalId: `E${i + 1}`, name: `Night ${i + 1}`, date: `2025-01-${10 + i}`, country }));
  feed.bouts = feed.events.flatMap((e, i) => [{ ...feed.bouts[0], externalId: `B${i}`, eventExternalId: e.externalId, redExternalId: "e", blueExternalId: i % 2 ? "s" : "u", winnerExternalId: "e" }]);
  feed.weighIns = []; feed.scorecards = []; feed.officials = []; feed.corners = []; feed.punches = []; feed.stints = [];
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  const w = await (await import("../lib/world")).getWorld();
  const { countryView } = await import("../lib/countries");
  const uk = countryView(w, "united-kingdom")!, en = countryView(w, "england")!, wa = countryView(w, "wales");
  assert.equal(uk.fighters, 3, "England, Scotland and the United Kingdom's own");
  assert.equal(uk.eventCount, 3, "England's, Wales's and its own");
  assert.deepEqual(uk.nations.map((n) => n.name).sort(), ["England", "Scotland"], "the nations that have fighters");
  assert.equal(en.fighters, 1); assert.equal(en.eventCount, 1); assert.deepEqual(en.nations, []);
  assert.equal(wa?.eventCount ?? 0, 0, "a nation with a card and no fighter has no page, as any country");
  assert.equal(countryView(w, "mexico"), null, "a country with no fighter who has fought has no page");
});

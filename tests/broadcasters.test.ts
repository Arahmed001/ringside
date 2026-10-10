import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";
import { broadcasterSlug, canonicalBroadcaster } from "../lib/broadcasters";

process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("broadcasters");
after(cleanup);
let db: DatabaseSync;
before(async () => { db = await (await import("../lib/db")).getDb(); });

test("the spellings of one channel are one broadcaster, and a field that only says how a card was sold names nobody", () => {
  const same: [string, string][] = [["ShowTime", "Showtime"], ["Showtime PPV", "Showtime"], ["DAZN PPV", "DAZN"], ["ESPN 2", "ESPN"], ["ESPN Deportes", "ESPN"], ["ESPN+ PPV", "ESPN+"],
    ["BT Sport 1", "TNT Sports"], ["TNT Sports 1", "TNT Sports"], ["Sky Box Office HD", "Sky Sports"], ["TrillerTV PPV US", "TrillerTV"], ["Fox Sports 1", "FOX"], ["FOX Sports PPV", "FOX"],
    ["Amazon Prime", "Amazon Prime Video"], ["YouTube UK", "YouTube"], ["Channel 5", "Channel 5"]];
  for (const [raw, name] of same) assert.equal(canonicalBroadcaster(raw), name, raw);
  for (const raw of ["Pay Per View", "Internet PPV", "Internet Stream", "string", "N/A", "", "  ", null, undefined]) assert.equal(canonicalBroadcaster(raw), null, String(raw));
  assert.equal(broadcasterSlug("ESPN+"), "broadcaster-espn-plus");
  assert.equal(broadcasterSlug("TNT Sports"), "broadcaster-tnt-sports");
});

test("linking gives each channel one organisation and points its cards at it, and running it again changes nothing", async () => {
  const { linkBroadcasters } = await import("../lib/broadcaster-link");
  const ins = db.prepare("INSERT INTO events (name, date, venue, city, country, broadcaster) VALUES (?,?,?,?,?,?)");
  db.exec("DELETE FROM events");
  ["ShowTime", "Showtime PPV", "DAZN", "DAZN PPV", "DAZN", "Pay Per View", "ESPN 2"].forEach((b, i) => ins.run(`E${i}`, `2025-03-0${i + 1}`, "V", "C", "X", b));
  const r = linkBroadcasters(db);
  assert.deepEqual(r, { broadcasters: 3, events: 6, unnamed: 1 });
  const orgs = (db.prepare("SELECT name, slug, kind FROM orgs WHERE kind = 'broadcaster' ORDER BY name").all() as { name: string; slug: string; kind: string }[]).map((o) => `${o.name}:${o.slug}`);
  assert.deepEqual(orgs, ["DAZN:broadcaster-dazn", "ESPN:broadcaster-espn", "Showtime:broadcaster-showtime"]);
  const of = (name: string) => (db.prepare("SELECT COUNT(*) n FROM events e JOIN orgs o ON o.id = e.broadcaster_org_id WHERE o.name = ?").get(name) as { n: number }).n;
  assert.deepEqual([of("Showtime"), of("DAZN"), of("ESPN")], [2, 3, 1]);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM events WHERE broadcaster = 'Pay Per View' AND broadcaster_org_id IS NOT NULL").get() as { n: number }).n, 0);
  assert.deepEqual(linkBroadcasters(db), r);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM orgs WHERE kind = 'broadcaster'").get() as { n: number }).n, 3, "no duplicate organisations");
});

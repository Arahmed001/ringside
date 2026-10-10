import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";
import { extractTeam, applyTeam, replayTeam, TEAM_SOURCE_ID } from "../lib/watch/team";

process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("watch-team");
after(cleanup);
let db: DatabaseSync;
before(async () => { db = await (await import("../lib/db")).getDb(); });

const ref = '<ref name="x">{{cite web|url=https://example.org|title=T}}</ref>';
const ARTICLE = `{{Infobox boxer|name=Jack Rowe}}
Rowe was trained by [[Teddy Atlas]]${ref} for most of his career. He signed with [[Top Rank]] in 2015.
Rowe's manager, [[Sam Smith (manager)|Sam Smith]], said he would fight again. He trains out of the [[Wild Card Boxing Club]] in Hollywood.
Before the fight, Dunn's trainer [[Joe Gallagher]] said his man was ready. Rowe's former trainer [[Pete Brown]] left in 2012. The manager of [[Celtic F.C.|Celtic]], [[Neil Lennon]], called him.
Rowe was trained by [[Rowe Gym]] the other day. He joined the [[Ohio National Guard]].
`;

test("a corner is read only from a sentence about the fighter's own corner: the opponent's trainer, a former trainer and a football manager are not read", () => {
  const got = extractTeam(ARTICLE, "Jack Rowe").map((c) => `${c.role}:${c.title}`).sort();
  assert.deepEqual(got, ["gym:Wild Card Boxing Club", "head_trainer:Teddy Atlas", "manager:Sam Smith (manager)", "promoter:Top Rank"]);
  const sam = extractTeam(ARTICLE, "Jack Rowe").find((c) => c.title.startsWith("Sam"))!;
  assert.equal(sam.display, "Sam Smith", "the shown name drops the disambiguation");
  assert.match(sam.quote, /Rowe's manager, Sam Smith, said/, "the sentence is kept, with the links turned into plain words");
});

const proposal = (over: Record<string, unknown> = {}) => ({ kind: "team_added", targetKey: "team|b1|head_trainer|teddy-atlas", old: null, new: {}, evidence: { quote: "Rowe was trained by Teddy Atlas.", apply: { boxerExternalId: "b1", role: "head_trainer", title: "Teddy Atlas", display: "Teddy Atlas", url: "https://en.wikipedia.org/wiki/Jack_Rowe", ...over } } });

test("approving a corner makes the person and an undated stint with its source, twice is the same, and a gym or promoter makes an organisation", () => {
  db.exec("DELETE FROM team_stints; DELETE FROM people; DELETE FROM orgs; DELETE FROM boxers");
  db.prepare("INSERT INTO boxers (external_id, slug, name, country, weight_class) VALUES ('b1', 'jack-rowe', 'Jack Rowe', 'United States', 'Lightweight')").run();
  assert.deepEqual(applyTeam(db, proposal()), { ok: true, changed: true });
  assert.deepEqual(applyTeam(db, proposal()), { ok: true, changed: false }, "the same approval again changes nothing");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM people").get() as { n: number }).n, 1);
  const st = db.prepare("SELECT role, start_date, end_date, source, source_url, note FROM team_stints").get() as Record<string, string | null>;
  assert.deepEqual([st.role, st.start_date, st.end_date, st.source, st.source_url], ["head_trainer", null, null, "Wikipedia (CC BY-SA 4.0)", "https://en.wikipedia.org/wiki/Jack_Rowe"]);
  assert.match(st.note!, /Teddy Atlas/);
  assert.deepEqual(applyTeam(db, proposal({ role: "gym", title: "Wild Card Boxing Club", display: "Wild Card Boxing Club" })), { ok: true, changed: true });
  assert.deepEqual(applyTeam(db, proposal({ role: "promoter", title: "Top Rank", display: "Top Rank" })), { ok: true, changed: true });
  assert.deepEqual((db.prepare("SELECT kind FROM orgs ORDER BY kind").all() as { kind: string }[]).map((o) => o.kind), ["gym", "promotion"]);
  assert.deepEqual(applyTeam(db, proposal({ boxerExternalId: "nobody" })), { ok: false, error: "gone" });
  assert.deepEqual(applyTeam(db, proposal({ role: "cutman" })), { ok: false, error: "bad_proposal" });
});

test("an undated stint claims no fight, so a trainer's tenure and rating change are not worked out from a whole career", async () => {
  const { boutsInWindow } = await import("../lib/team");
  const w = { boutsByBoxer: new Map([[1, [{ upcoming: false, method: "UD", date: "2020-01-01" }, { upcoming: false, method: "KO", date: "2022-01-01" }]]]) } as never;
  assert.equal(boutsInWindow(w, 1, null, null).length, 0);
  assert.equal(boutsInWindow(w, 1, "2021-01-01", null).length, 1, "a stint with a start date still counts the fights from then");
  assert.equal(boutsInWindow(w, 1, null, "2021-01-01").length, 1, "and one with only an end date counts the fights before it");
});

test("replaying puts approved corners back after a reload, and only the approved ones", async () => {
  const { accountsDb } = await import("../lib/accounts/store");
  const acc = accountsDb();
  const ins = acc.prepare("INSERT INTO proposals (source, kind, target_key, label, old_json, new_json, evidence_json, fingerprint, status, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const p = proposal({ title: "Freddie Roach", display: "Freddie Roach" });
  ins.run(TEAM_SOURCE_ID, "team_added", "team|b1|head_trainer|freddie-roach", "x", "null", "{}", JSON.stringify(p.evidence), "f1", "approved", "2026-10-10", "2026-10-10");
  ins.run(TEAM_SOURCE_ID, "team_added", "team|b1|head_trainer|nope", "x", "null", "{}", JSON.stringify(proposal({ title: "Not Approved", display: "Not Approved" }).evidence), "f2", "pending", "2026-10-10", "2026-10-10");
  db.exec("DELETE FROM team_stints");
  assert.deepEqual(replayTeam(db, acc), { applied: 1, alreadyThere: 0, skipped: 0 });
  assert.deepEqual(replayTeam(db, acc), { applied: 0, alreadyThere: 1, skipped: 0 });
  assert.deepEqual((db.prepare("SELECT p.name FROM team_stints s JOIN people p ON p.id = s.person_id").all() as { name: string }[]).map((x) => x.name), ["Freddie Roach"]);
});

test("a sentence about the fighter's relative, or a link that is not a person, is not read as the fighter's corner", () => {
  const a = `Miguel Cotto's uncle David was trained by [[Bob Foster]] in Albuquerque. Buatsi was managed by two-time world [[heavyweight]] champion [[Anthony Joshua]]. Cotto is now trained by [[Freddie Roach]].`;
  assert.deepEqual(extractTeam(a, "Miguel Cotto").map((c) => c.title), ["Freddie Roach"]);
  assert.deepEqual(extractTeam(a, "Joshua Buatsi").map((c) => c.title), [], "the first link after the cue is \"heavyweight\", not a name: nothing is proposed rather than a guess");
});

test("one person or company is one row however the sentences and page titles spell it: a section, a disambiguation, a possessive", async () => {
  const { cleanTitle } = await import("../lib/watch/team");
  assert.equal(cleanTitle("Jake Paul#Most Valuable Promotions"), "Most Valuable Promotions");
  assert.equal(cleanTitle("Billy Nelson (Boxer)"), "Billy Nelson");
  assert.equal(cleanTitle("Don King (boxing promoter)"), "Don King");
  assert.equal(cleanTitle("Top Rank"), "Top Rank");
  db.exec("DELETE FROM team_stints; DELETE FROM people; DELETE FROM orgs; DELETE FROM boxers");
  db.prepare("INSERT INTO boxers (external_id, slug, name, country, weight_class) VALUES ('b1', 'jack-rowe', 'Jack Rowe', 'United States', 'Lightweight'), ('b2', 'sam-poe', 'Sam Poe', 'United States', 'Lightweight')").run();
  const p = (boxer: string, title: string, display: string) => ({ kind: "team_added", targetKey: `team|${boxer}|promoter|x`, old: null, new: {}, evidence: { quote: "q", apply: { boxerExternalId: boxer, role: "promoter", title, display, url: "https://en.wikipedia.org/wiki/X" } } });
  applyTeam(db, p("b1", "Frank Warren (promoter)", "Frank Warren's"));
  applyTeam(db, p("b2", "Frank Warren", "Frank Warren"));
  assert.deepEqual((db.prepare("SELECT name FROM orgs").all() as { name: string }[]).map((o) => o.name), ["Frank Warren"], "both fighters point at one organisation, named by its page");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM team_stints").get() as { n: number }).n, 2);
  applyTeam(db, { ...p("b1", "Billy Nelson (Boxer)", "Billy Nelson"), evidence: { quote: "q", apply: { boxerExternalId: "b1", role: "head_trainer", title: "Billy Nelson (Boxer)", display: "Billy Nelson’s", url: "u" } } });
  assert.deepEqual((db.prepare("SELECT name FROM people").all() as { name: string }[]).map((x) => x.name), ["Billy Nelson"], "a possessive is not part of the name");
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DEFAULT_DATABASE, enrichPlan, enrichSteps, isEnrichConfirmation, looksLikeContact, runSteps, selectSteps } from "../lib/vendor-enrich";

/** `npm run vendor:enrich` (round 90): the steps after the load, guided; they call third-party services, so nothing runs without the typed word. */
const ROOT = path.resolve(__dirname, "..");

test("the steps are the runbook's, in its order, each pointing at a script that exists", () => {
  const steps = enrichSteps();
  assert.deepEqual(steps.map((s) => s.id), ["staging", "enrich", "champions", "venues", "headshots", "entities"]);
  for (const s of steps) assert.ok(fs.existsSync(path.join(ROOT, s.script)), `${s.id}: ${s.script} exists`);
  assert.deepEqual(steps.find((s) => s.id === "enrich")!.args, ["--enrich"]);
  assert.deepEqual(steps.find((s) => s.id === "entities")!.args, ["--entities"]);
  assert.deepEqual(enrichSteps(200).filter((s) => ["venues", "headshots", "entities"].includes(s.id)).map((s) => s.args.slice(-2)), [["--limit", "200"], ["--limit", "200"], ["--limit", "200"]], "--media-limit caps the three media steps");
  assert.ok(!enrichSteps(200).find((s) => s.id === "champions")!.args.includes("--limit"));
});

test("selecting steps: only, skip, and an unknown name is an error", () => {
  const all = enrichSteps();
  assert.deepEqual(selectSteps(all, ["enrich", "champions"], undefined).map((s) => s.id), ["enrich", "champions"]);
  assert.deepEqual(selectSteps(all, undefined, ["staging", "entities"]).map((s) => s.id), ["enrich", "champions", "venues", "headshots"]);
  assert.deepEqual(selectSteps(all, ["champions", "enrich"], undefined).map((s) => s.id), ["enrich", "champions"], "always in the runbook's order");
  assert.throws(() => selectSteps(all, ["photos"], undefined), /There is no step "photos"\. The steps are: staging, enrich/);
});

test("the plan: the contact is the owner's to give and must be reachable, the database defaults to the load's, and the refusals say how to fix them", () => {
  const p = enrichPlan([], {});
  assert.equal(p.database, DEFAULT_DATABASE); assert.equal(p.steps.length, 6);
  assert.match(p.refusal ?? "", /WIKIMEDIA_CONTACT is not set.*WIKIMEDIA_CONTACT=you@example\.org, or --contact/);
  assert.equal(enrichPlan([], { WIKIMEDIA_CONTACT: "me@example.org" }).refusal, null);
  assert.equal(enrichPlan(["--contact", "https://example.org/about"], {}).refusal, null);
  assert.equal(enrichPlan(["--contact", "me@example.org"], { WIKIMEDIA_CONTACT: "other@example.org" }).contact, "me@example.org", "the flag wins");
  assert.match(enrichPlan([], { WIKIMEDIA_CONTACT: "not a contact" }).refusal ?? "", /does not look like an email address or a web page/);
  assert.equal(enrichPlan([], { WIKIMEDIA_CONTACT: "me@example.org", DATABASE_PATH: "/x/y.db" }).database, "/x/y.db");
  assert.match(enrichPlan(["--steps", "enrich", "--skip", "enrich"], { WIKIMEDIA_CONTACT: "me@example.org" }).refusal ?? "", /No step is selected/);
  assert.throws(() => enrichPlan(["--media-limit", "0"], {}), /--media-limit must be a whole number above 0/);
  for (const ok of ["a@b.co", "https://example.org", "http://x.y/z"]) assert.equal(looksLikeContact(ok), true, ok);
  for (const no of ["", "a@b", "me", "ftp://x.y", "a b@c.de", "example.org"]) assert.equal(looksLikeContact(no), false, no);
  assert.equal(isEnrichConfirmation("ENRICH"), true); for (const x of ["enrich", "yes", "LOAD", "", "ENRICH IT"]) assert.equal(isEnrichConfirmation(x), false, x);
});

test("running the steps: in order, stopping at the first failure, and saying how far it got", async () => {
  const steps = enrichSteps();
  const seen: string[] = [];
  const ok = await runSteps(steps, async (s) => { seen.push(s.id); return 0; });
  assert.deepEqual(ok, { done: steps.map((s) => s.id), code: 0 }); assert.deepEqual(seen, steps.map((s) => s.id));
  seen.length = 0;
  const bad = await runSteps(steps, async (s) => { seen.push(s.id); return s.id === "champions" ? 3 : 0; });
  assert.deepEqual(bad, { done: ["staging", "enrich"], failed: "champions", code: 3 });
  assert.deepEqual(seen, ["staging", "enrich", "champions"], "nothing after the failure ran");
});

const run = (args: string[], env: Record<string, string>) => new Promise<{ code: number | null; out: string }>((resolve) => {
  const c = spawn(process.execPath, ["--import", "tsx", "scripts/vendor-enrich.ts", ...args], { cwd: ROOT, env: { ...process.env, WIKIMEDIA_CONTACT: "", DATABASE_PATH: "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
  c.on("close", (code) => resolve({ code, out }));
});

test("the script refuses before it touches anything: no contact, no loaded database, no typed confirmation; a dry run only lists", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "venrich-")), db = path.join(d, "real.db");
  const noContact = await run([], { DATABASE_PATH: db });
  assert.equal(noContact.code, 1); assert.match(noContact.out, /WIKIMEDIA_CONTACT is not set/); assert.match(noContact.out, /6 step|staging[\s\S]*entities/);
  const noDb = await run(["--contact", "me@example.org", "--yes"], { DATABASE_PATH: db });
  assert.equal(noDb.code, 1); assert.match(noDb.out, /holds no fighters\. Load the league first \(npm run vendor:load\)/);
  const { DatabaseSync } = await import("node:sqlite");
  const x = new DatabaseSync(db); x.exec("CREATE TABLE boxers (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO boxers (name) VALUES ('A'), ('B');"); x.close();
  const noTty = await run(["--contact", "me@example.org"], { DATABASE_PATH: db });
  assert.equal(noTty.code, 1); assert.match(noTty.out, /not an interactive terminal.*--yes.*Nothing was run/); assert.match(noTty.out, /database: .*real\.db \(2 fighters\)/); assert.match(noTty.out, /contact:  me@example\.org  \(sent to Wikimedia/);
  const dry = await run(["--dry-run", "--contact", "me@example.org"], { DATABASE_PATH: db });
  assert.equal(dry.code, 0); assert.match(dry.out, /--dry-run: nothing was run\./);
  for (const id of ["staging", "enrich", "champions", "venues", "headshots", "entities"]) assert.match(dry.out, new RegExp(`\\d\\. ${id}\\b`));
  assert.match(dry.out, /call Wikidata, Wikipedia and Wikimedia Commons/);
  const dryNoContact = await run(["--dry-run"], { DATABASE_PATH: db });
  assert.equal(dryNoContact.code, 0); assert.match(dryNoContact.out, /would be refused: WIKIMEDIA_CONTACT is not set/);
  const badStep = await run(["--dry-run", "--steps", "photos"], { DATABASE_PATH: db });
  assert.equal(badStep.code, 1); assert.match(badStep.out, /There is no step "photos"/);
});

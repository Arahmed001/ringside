import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileProvider } from "../lib/providers/file";
import { loadFeed } from "../lib/feed";
import { sanitizeFeed } from "../lib/validate";
import { miniFeed } from "./helpers";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-feed-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const write = (name: string, data: unknown) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(data)); return p; };

test("a JSON file feed loads, and vendor spellings of the result method are normalised", async () => {
  const feed = miniFeed();
  (feed.bouts[0] as { method: string }).method = "Decision - Unanimous";
  const loaded = await loadFeed(fileProvider(write("a.json", feed)));
  assert.equal(loaded.bouts[0].method, "UD");
  assert.equal(sanitizeFeed(loaded, { today: "2026-10-03" }).issues.filter((i) => i.severity === "error").length, 0);
});

test("missing arrays are treated as empty", async () => {
  const loaded = await loadFeed(fileProvider(write("b.json", { boxers: miniFeed().boxers })));
  assert.equal(loaded.bouts.length, 0); assert.equal(loaded.stints.length, 0);
});

test("an unknown method is passed through for the validator to reject", async () => {
  const feed = miniFeed();
  (feed.bouts[0] as { method: string }).method = "Walkover";
  const { issues } = sanitizeFeed(await loadFeed(fileProvider(write("c.json", feed))), { today: "2026-10-03" });
  assert.ok(issues.some((i) => i.code === "unknown_method"));
});

const check = (file: string) => spawnSync(process.execPath, ["--import", "tsx", "scripts/check-feed.ts", "--file", file], { encoding: "utf8", env: { ...process.env, RINGSIDE_NOW: "2026-10-03" } });

test("data:check exits 0 for a clean feed and 1 when rows would be dropped", () => {
  const good = check(write("good.json", miniFeed()));
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /0 error\(s\)/);
  const bad = miniFeed();
  bad.boxers[0].weightClass = "Catchweight";
  const r = check(write("bad.json", bad));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /unknown_division/);
  assert.match(r.stdout, /bad_reference/);
});

test("data:check reports a missing file instead of crashing silently", () => {
  const r = check(path.join(dir, "nope.json"));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ENOENT|no such file/i);
});

test("the demo provider's own feed passes validation with nothing to report", () => {
  const out = execFileSync(process.execPath, ["--import", "tsx", "scripts/check-feed.ts"], { encoding: "utf8", env: { ...process.env, RINGSIDE_NOW: "2026-10-03" } });
  assert.match(out, /0 error\(s\), 0 warning\(s\)/);
});

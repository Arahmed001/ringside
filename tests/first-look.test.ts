import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDb } from "./helpers";

const cleanup = tempDb("first-look");
const out = path.join(os.tmpdir(), `ringside-first-look-${process.pid}.md`);
after(() => { cleanup(); fs.rmSync(out, { force: true }); });

test("npm run first-look describes a database in counts: the numbers are the database's, and no name of a fighter or a card is in it (round 133)", async () => {
  const { getWorld } = await import("../lib/world");
  const w = await getWorld();
  execFileSync(process.execPath, ["--import", "tsx", "scripts/first-look.ts", "--database", process.env.DATABASE_PATH!, "--out", out], { env: { ...process.env, NODE_NO_WARNINGS: "1" }, stdio: "pipe" });
  const text = fs.readFileSync(out, "utf8");
  for (const h of ["## Size", "## Fighters", "## Fights", "## Cards", "## What is empty", "## What the load itself noted"]) assert.ok(text.includes(h), h);
  const n = (x: number) => x.toLocaleString("en-US");
  assert.match(text, new RegExp(`\\| Fighters \\| ${n(w.boxers.length)} \\|`));
  assert.match(text, new RegExp(`\\| Fights \\| ${n(w.bouts.length)} \\|`));
  assert.match(text, new RegExp(`\\| Cards \\| ${n(w.events.length)} \\|`));
  for (const b of w.boxers.slice(0, 40)) assert.ok(!text.includes(b.name), `a fighter's name (${b.name}) is in the document`);
  for (const e of w.events.slice(0, 20)) assert.ok(!text.includes(e.name), `a card's name (${e.name}) is in the document`);
  assert.ok(!/NaN|undefined|null/.test(text), "no broken value");
});

test("without a database it says how to run it and stops", () => {
  assert.throws(() => execFileSync(process.execPath, ["--import", "tsx", "scripts/first-look.ts"], { stdio: "pipe" }), (e: { status?: number; stderr?: Buffer }) => e.status === 2 && /Usage: npm run first-look/.test(String(e.stderr)));
});

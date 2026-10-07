/**
 * npm run gate [-- --fresh] [--quick] [--keep-going]
 * What CI runs before a change reaches main, as one command: route types, type check, lint, translations, data validation, the tests, the production build, the six smoke runs and
 * the audit of what ships (lib/gate.ts has the list; tests/gate.test.ts keeps it in step with .github/workflows/ci.yml). It stops at the first failure unless --keep-going.
 *   --fresh        run in a clean clone of the last COMMIT (npm ci, the same files CI would check out): a used folder is not a clean checkout (it has a demo database, a build cache,
 *                  ignored files), and several tests have passed in one and failed in the other. Uncommitted changes are not in the clone: the command says so.
 *   --quick        stop after the build (no smoke runs, no audit).
 * Exit code 0 only if every step passed; the smoke runs must end with "N/N ok", the tests with no failures.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gateSteps, summarize, type Result } from "../lib/gate";

const argv = process.argv.slice(2), has = (f: string) => argv.includes(f);
const fresh = has("--fresh"), quick = has("--quick"), keepGoing = has("--keep-going");
const root = path.resolve(__dirname, "..");

function git(args: string[], cwd = root) { const r = spawnSync("git", args, { cwd, encoding: "utf8" }); return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() }; }

let cwd = root;
if (fresh) {
  const dirty = git(["status", "--porcelain"]).out;
  if (dirty) console.log(`note: ${dirty.split("\n").length} uncommitted change(s) are not in the clean clone; commit them first to check them.\n`);
  const head = git(["rev-parse", "HEAD"]).out, tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-gate-"));
  const c = git(["clone", "--quiet", root, tmp]);
  if (!c.ok || !git(["checkout", "--quiet", head], tmp).ok) { console.error(`could not make the clean clone: ${c.err}`); process.exit(1); }
  cwd = tmp;
  console.log(`clean clone of ${head.slice(0, 7)} in ${tmp}\n`);
}

const steps = gateSteps({ install: fresh, quick });
const results: Result[] = [];
for (const step of steps) {
  const t0 = Date.now();
  process.stdout.write(`... ${step.label}`);
  const r = spawnSync(step.cmd, step.args, { cwd, encoding: "utf8", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...step.env }, maxBuffer: 256 * 1024 * 1024 });
  const output = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const why = r.status !== 0 ? `exit code ${r.status ?? r.signal}` : step.proves?.(output) ?? null;
  const seconds = (Date.now() - t0) / 1000;
  results.push({ step, ok: !why, seconds, why: why ?? undefined });
  console.log(`\r${why ? "FAIL" : "PASS"}  ${step.label}  (${seconds.toFixed(0)} s)`);
  if (why) {
    console.log(output.trim().split("\n").slice(-25).map((l) => `      ${l}`).join("\n"));
    if (!keepGoing) break;
  }
}
console.log(`\n${summarize(results, steps.length).join("\n")}`);
if (fresh && results.every((x) => x.ok)) fs.rmSync(cwd, { recursive: true, force: true });
process.exit(results.length === steps.length && results.every((x) => x.ok) ? 0 : 1);

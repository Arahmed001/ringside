import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SMOKE_VARIANTS, auditProof, gateSteps, smokeProof, summarize, testsProof, type Result } from "../lib/gate";

/** `npm run gate` (round 130): the proofs it demands, the steps it runs, and that CI still runs the same ones. */
const ROOT = path.resolve(__dirname, "..");
const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

test("a smoke run passes only if its last line says every page was fine", () => {
  assert.equal(smokeProof("✓ en /x (a, 3 ms)\n\n272/272 ok\n"), null);
  assert.equal(smokeProof("272/272 ok"), null);
  assert.match(smokeProof("270/272 ok · 2 with problems") ?? "", /not "N\/N ok"/, "the failure line is not a pass");
  assert.match(smokeProof("270/272 ok\n") ?? "", /270 of 272/, "a short count is not a pass");
  assert.match(smokeProof("0/0 ok") ?? "", /0 of 0/, "no pages visited is not a pass");
  assert.match(smokeProof("") ?? "", /not "N\/N ok"/); assert.match(smokeProof("No production build found. Run `npm run build` first.") ?? "", /not "N\/N ok"/, "the message that made the first overnight gate look like a pass");
  assert.equal(smokeProof("272/272 ok\n\n\n"), null, "trailing blank lines");
});

test("the test runner's summary must show no failure and at least one test; the audit must say 0 vulnerabilities", () => {
  assert.equal(testsProof("# tests 12\n# pass 12\n# fail 0\n"), null);
  assert.match(testsProof("# pass 11\n# fail 1\n") ?? "", /1 failing/); assert.match(testsProof("# pass 0\n# fail 0\n") ?? "", /0 passing/); assert.match(testsProof("") ?? "", /no test summary/);
  assert.equal(auditProof("found 0 vulnerabilities"), null); assert.match(auditProof("found 3 vulnerabilities") ?? "", /did not report 0/); assert.match(auditProof("") ?? "", /did not report 0/);
});

test("the steps: in CI's order, install only for a fresh clone, no smoke or audit when quick, six smoke leagues", () => {
  const ids = (o: { install: boolean; quick: boolean }) => gateSteps(o).map((s) => s.id);
  assert.deepEqual(ids({ install: false, quick: true }), ["typegen", "tsc", "lint", "i18n", "data", "tests", "build"]);
  assert.equal(ids({ install: true, quick: true })[0], "install");
  const full = gateSteps({ install: false, quick: false });
  assert.equal(full.filter((s) => s.id.startsWith("smoke")).length, 6); assert.equal(full.at(-1)?.id, "audit");
  assert.ok(full.indexOf(full.find((s) => s.id === "build")!) < full.indexOf(full.find((s) => s.id.startsWith("smoke"))!), "smoke needs the build");
  assert.deepEqual(full.find((s) => s.id === "data")?.env, { RINGSIDE_NOW: "2026-10-03" }, "pinned today, as in CI");
  for (const s of full.filter((x) => x.id.startsWith("smoke") || x.id === "tests" || x.id === "audit")) assert.ok(s.proves, `${s.id} is judged by its output, not only its exit code`);
  assert.deepEqual(full.find((s) => s.id === "smoke --feed hostile --crawl 60")?.args, ["run", "smoke", "--", "--feed", "hostile", "--crawl", "60"]);
});

test("CI still runs what the gate runs: the same smoke leagues, the same checks (so the two cannot drift apart)", () => {
  for (const v of SMOKE_VARIANTS) assert.ok(ci.includes(v.length ? `npm run smoke -- ${v.join(" ")}` : "run: npm run smoke\n"), `CI no longer runs the smoke league ${JSON.stringify(v)}`);
  for (const cmd of ["npx next typegen", "npx tsc --noEmit", "npm run lint", "npm run data:check", "npm run build", "audit --omit=dev"]) assert.ok(ci.includes(cmd), `CI no longer runs ${cmd}`);
  assert.match(ci, /RINGSIDE_NOW: "2026-10-03"/);
});

test("the report names each step, says what failed and what did not run, and only a complete clean run passes", () => {
  const [a, b] = gateSteps({ install: false, quick: true }), r = (step: typeof a, ok: boolean, why?: string): Result => ({ step, ok, seconds: 2.4, why });
  assert.match(summarize([r(a, true), r(b, true)], 2).join("\n"), /GATE PASSED/);
  const bad = summarize([r(a, true), r(b, false, "exit code 1")], 7).join("\n");
  assert.match(bad, /FAIL .*type check: exit code 1/); assert.match(bad, /GATE FAILED: 1 step failed, 5 not run/);
  assert.match(summarize([r(a, true)], 7).join("\n"), /GATE INCOMPLETE: 6 steps not run/, "stopping early is never a pass");
  assert.match(summarize([r(a, false)], 1).join("\n"), /GATE FAILED: 1 step failed\./);
});

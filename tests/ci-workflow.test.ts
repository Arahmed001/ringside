import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * The CI workflow is configuration nobody can run locally, and a typo in it means CI silently stops. (Round 91: the repository is private, so Actions minutes are metered, and
 * the workflow was reshaped to use fewer.) These tests pin what must stay true: it parses, every job and output it names exists, main still runs everything, and the
 * change classifier says "run everything" whenever it is unsure.
 */
const ROOT = path.resolve(__dirname, "..");
interface Step { name?: string; if?: string; run?: string; uses?: string }
interface Job { needs?: string; if?: string; env?: Record<string, string>; steps: Step[]; outputs: Record<string, string> }
interface Workflow { on: Record<string, { branches?: string[] } | null>; concurrency: Record<string, string>; jobs: Record<string, Job> }
const yaml = createRequire(__filename)("js-yaml") as { load: (s: string) => unknown };
const wf = yaml.load(fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as Workflow;

test("the workflow parses, runs on main and on pull requests, and has the jobs the rest of it refers to", () => {
  assert.deepEqual(Object.keys(wf.jobs), ["changes", "verify", "docker", "audit"]);
  assert.ok(wf.on.push?.branches?.includes("main") && "pull_request" in wf.on && "workflow_dispatch" in wf.on);
  assert.equal(wf.concurrency["cancel-in-progress"], "${{ github.event_name == 'pull_request' }}", "only a pull request's superseded run is cancelled; every main push is verified");
  for (const j of ["verify", "docker", "audit"]) assert.equal(wf.jobs[j].needs, "changes", `${j} waits for the classifier`);
  const outs = Object.keys(wf.jobs.changes.outputs);
  assert.deepEqual(outs.sort(), ["deps", "docker", "docs_only"]);
  const text = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  for (const m of text.matchAll(/needs\.changes\.outputs\.(\w+)/g)) assert.ok(outs.includes(m[1]), `an output that exists: ${m[1]}`);
});

test("on main everything runs whatever changed; the savings apply to pull requests and docs-only changes", () => {
  const steps = wf.jobs.verify.steps;
  const step = (frag: string) => steps.find((s) => (s.run ?? s.name ?? "").includes(frag))!;
  for (const frag of ["tsc --noEmit", "npm run lint", "npm test", "npm run build", "npm run smoke"]) assert.equal(step(frag).if, "env.DOCS_ONLY != 'true'", `${frag} is skipped only for a docs-only change`);
  assert.equal(step("--feed sparse").if, "env.DOCS_ONLY != 'true' && github.event_name != 'pull_request'", "the extra smoke variants run on main and not on pull requests");
  assert.equal(step("tests/config-docs.test.ts").if, "env.DOCS_ONLY == 'true'");
  assert.equal(wf.jobs.docker.if, "github.event_name != 'pull_request' || needs.changes.outputs.docker == 'true'", "the image is built on every main push");
  assert.equal(wf.jobs.audit.if, "github.event_name != 'pull_request' || needs.changes.outputs.deps == 'true'");
  assert.equal(wf.jobs.verify.env?.DOCS_ONLY, "${{ needs.changes.outputs.docs_only }}");
  assert.ok(wf.jobs.verify.steps.some((s) => (s.uses ?? "").startsWith("actions/cache@")), "the Next build cache is kept");
});

test("the classifier: docs-only only when every file is Markdown or under docs/, and when unsure it says run everything", async () => {
  const { classify } = await import("../scripts/ci-changes.mjs");
  assert.deepEqual(classify(["docs/real-data-runbook.md", "PLAN.md", "README.md"]), { docs_only: true, docker: false, deps: false, count: 3 });
  assert.equal(classify(["docs/a.md", "lib/world.ts"]).docs_only, false, "one code file and it is not docs-only");
  assert.equal(classify(["lib/world.ts"]).docker, false); assert.equal(classify(["lib/world.ts"]).deps, false);
  assert.equal(classify(["package-lock.json"]).deps, true); assert.equal(classify(["package.json", "lib/x.ts"]).docker, true);
  for (const f of ["Dockerfile", ".dockerignore", "next.config.ts"]) assert.equal(classify([f]).docker, true, f);
  assert.deepEqual(classify([".github/workflows/ci.yml", "docs/a.md"]), { docs_only: false, docker: true, deps: false, count: 2 }, "a change to CI itself runs everything");
  for (const unsure of [[], [""], ["(unknown)"], ["docs/a.md", "(unknown)"]]) assert.deepEqual(classify(unsure), { docs_only: false, docker: true, deps: true, count: unsure.filter((x) => x.trim()).length }, JSON.stringify(unsure));
});

test("the classifier as the workflow runs it: names on stdin, name=value lines out", async () => {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, ["scripts/ci-changes.mjs"], { cwd: ROOT, input: "docs/a.md\nREADME.md\n", encoding: "utf8" });
  assert.equal(r.status, 0); assert.equal(r.stdout, "docs_only=true\ndocker=false\ndeps=false\ncount=2\n");
  assert.equal(spawnSync(process.execPath, ["scripts/ci-changes.mjs"], { cwd: ROOT, input: "lib/x.ts\n", encoding: "utf8" }).stdout, "docs_only=false\ndocker=false\ndeps=false\ncount=1\n");
});

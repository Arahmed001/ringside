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
interface Job { needs?: string | string[]; if?: string; env?: Record<string, string>; steps: Step[]; outputs: Record<string, string>; strategy?: { matrix: { shard: number[] } } }
interface Workflow { on: Record<string, { branches?: string[] } | null>; concurrency: Record<string, string>; jobs: Record<string, Job> }
const yaml = createRequire(__filename)("js-yaml") as { load: (s: string) => unknown };
const wf = yaml.load(fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as Workflow;

test("the workflow parses, runs on main and on pull requests, and has the jobs the rest of it refers to", () => {
  assert.deepEqual(Object.keys(wf.jobs), ["changes", "static", "tests", "build", "verify", "docker", "audit"]);
  assert.ok(wf.on.push?.branches?.includes("main") && "pull_request" in wf.on && "workflow_dispatch" in wf.on);
  assert.equal(wf.concurrency["cancel-in-progress"], "${{ github.event_name == 'pull_request' }}", "only a pull request's superseded run is cancelled; every main push is verified");
  for (const j of ["static", "tests", "build", "docker", "audit"]) assert.equal(wf.jobs[j].needs, "changes", `${j} waits for the classifier`);
  const outs = Object.keys(wf.jobs.changes.outputs);
  assert.deepEqual(outs.sort(), ["deps", "docker", "docs_only"]);
  const text = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  for (const m of text.matchAll(/needs\.changes\.outputs\.(\w+)/g)) assert.ok(outs.includes(m[1]), `an output that exists: ${m[1]}`);
});

test("`verify` (the check a pull request is held to) waits for every part and fails unless each passed; a docs-only change skips the parts and runs the docs test in it", () => {
  const v = wf.jobs.verify;
  assert.deepEqual([...(v.needs as string[])].sort(), ["build", "changes", "static", "tests"], "verify waits for every part, so none can be left out of the check");
  assert.equal(v.if, "always()", "verify runs even when a part failed, so it reports red instead of being skipped (a skipped required check passes)");
  assert.equal(v.env?.DOCS_ONLY, "${{ needs.changes.outputs.docs_only }}");
  const gate = v.steps.find((s) => (s.run ?? "").includes("expected $want"))!;
  assert.equal(gate.if, "always()");
  assert.match(gate.run!, /\$CHANGES" = success/, "the classifier itself must have succeeded");
  assert.match(gate.run!, /DOCS_ONLY" = true \]; then want=skipped; else want=success/, "docs-only expects the parts skipped; anything else expects them to have passed");
  for (const part of ["STATIC", "TESTS", "BUILD"]) assert.match(gate.run!, new RegExp(`"\\$${part}"`), `${part} is checked`);
  const docs = v.steps.find((s) => (s.run ?? "").includes("tests/config-docs.test.ts"))!;
  assert.equal(docs.if, "env.DOCS_ONLY == 'true'");
  for (const j of ["static", "tests", "build"]) assert.equal(wf.jobs[j].if, "needs.changes.outputs.docs_only != 'true'", `${j} is skipped only for a docs-only change`);
});

test("on main everything runs whatever changed; the savings apply to pull requests and docs-only changes", () => {
  const all = (frag: string) => Object.entries(wf.jobs).flatMap(([name, j]) => j.steps?.filter((s) => { const t = s.run ?? s.name ?? ""; return frag.endsWith("$") ? t === frag.slice(0, -1) : t.includes(frag); }).map((s) => ({ name, s })) ?? []);
  const only = (frag: string, job: string) => { const hit = all(frag); assert.equal(hit.length, 1, `${frag} runs once`); assert.equal(hit[0].name, job); return hit[0].s; };
  for (const [frag, job] of [["next typegen", "static"], ["tsc --noEmit", "static"], ["npm run lint", "static"], ["npm run data:check", "static"], ["npm run build", "build"], ["npm run smoke$", "build"]] as const) {
    const s = only(frag, job);
    assert.equal(s.if, undefined, `${frag} has no condition of its own: the job's condition (skipped only when docs-only) is the only one`);
  }
  assert.equal(only("--feed sparse", "build").if, "github.event_name != 'pull_request'", "the extra smoke variants run on main and not on pull requests");
  assert.equal(wf.jobs.docker.if, "github.event_name != 'pull_request' || needs.changes.outputs.docker == 'true'", "the image is built on every main push");
  assert.equal(wf.jobs.audit.if, "github.event_name != 'pull_request' || needs.changes.outputs.deps == 'true'");
  assert.ok(wf.jobs.build.steps.some((s) => (s.uses ?? "").startsWith("actions/cache@")), "the Next build cache is kept");
});

test("the tests run as SHARDS pieces, the matrix has one entry for each, and the pieces together are every test file exactly once", async () => {
  const { testFiles, shard } = await import("../scripts/ci-test-shard.mjs");
  const job = wf.jobs.tests;
  const total = Number(job.env?.SHARDS);
  assert.ok(total >= 1);
  assert.deepEqual(job.strategy?.matrix.shard, Array.from({ length: total }, (_, i) => i + 1), "one matrix entry for every shard number, so no piece is left unrun");
  const run = job.steps.find((s) => (s.run ?? "").includes("--test"))!.run!;
  assert.match(run, /ci-test-shard\.mjs "\$\{\{ matrix\.shard \}\}" "\$SHARDS"/);
  assert.match(run, /node --import tsx --test --test-concurrency="\$\(nproc\)" \$files/, "the same runner as `npm test` (node --import tsx --test), on the shard's files");
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts.test, "node --import tsx --test tests/*.test.ts", "`npm test` still runs the whole suite in one go");
  const files = testFiles(ROOT);
  assert.ok(files.length > 100 && files.includes("tests/ci-workflow.test.ts"));
  for (const n of [1, 2, 3, 4, 5, 7, total]) {
    const pieces = Array.from({ length: n }, (_, i) => shard(files, i + 1, n));
    assert.deepEqual(pieces.flat().sort(), [...files].sort(), `${n} shards: together every file, none twice, none dropped`);
    for (const p of pieces) assert.ok(p.length > 0, `${n} shards: none is empty`);
  }
  assert.deepEqual(shard(files, 2, total), shard(files, 2, total), "the split is the same every time");
  assert.throws(() => shard(files, 0, 3)); assert.throws(() => shard(files, 4, 3));
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

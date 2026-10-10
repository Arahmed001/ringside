import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const yaml = createRequire(__filename)("js-yaml") as { load: (s: string) => unknown };

const text = fs.readFileSync(path.join(process.cwd(), ".github/workflows/deploy.yml"), "utf8");
const wf = yaml.load(text) as { on: Record<string, { workflows?: string[]; types?: string[]; branches?: string[] }>; concurrency: { group: string; "cancel-in-progress": boolean }; permissions: Record<string, string>; jobs: Record<string, { if: string }> };

test("the Fly deploy runs only after CI has passed on main, one at a time, and never from a pull request", () => {
  assert.deepEqual(wf.on.workflow_run, { workflows: ["CI"], types: ["completed"], branches: ["main"] });
  assert.ok(!("pull_request" in wf.on) && !("push" in wf.on), "no trigger of its own that skips CI");
  assert.match(wf.jobs.deploy.if, /conclusion == 'success'/);
  assert.equal(wf.concurrency["cancel-in-progress"], false, "a deploy is never cancelled half way");
  assert.deepEqual(wf.permissions, { contents: "read" });
});

test("it does nothing without the token, skips docs-only changes, and waits out the nightly update", () => {
  assert.match(text, /FLY_API_TOKEN is not set, so nothing is deployed/);
  assert.match(text, /only docs changed: not deployed/);
  assert.match(text, /"\$result" = "running"/);
  assert.match(text, /flyctl deploy --ha=false --remote-only -a "\$FLY_APP"/);
});

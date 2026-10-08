import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

// Agents work in git worktrees under .claude/worktrees. A lint of the repository root that walked into them reported 87,000 problems (2026-10-07), and a Docker build
// from a checkout that holds them would copy every one of them into the image's build context.
test("the lint and the Docker build context leave out .claude (agents' leftover worktrees)", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "eslint.config.mjs"), "utf8"), /globalIgnores\(\[[^\]]*"\.claude\/\*\*"/);
  assert.ok(fs.readFileSync(path.join(ROOT, ".dockerignore"), "utf8").split("\n").map((l) => l.trim()).includes(".claude"));
});

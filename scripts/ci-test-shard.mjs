// Splits tests/*.test.ts into balanced shards so CI can run them on several runners at once. Plain Node with no dependencies.
//   node scripts/ci-test-shard.mjs <shard> <of>     prints the files of shard <shard> (1-based) of <of>, one a line, ready for `node --test`
//
// Every file lands in exactly one shard (tests/ci-workflow.test.ts pins that: nothing is dropped and nothing runs twice, for any number of shards).
// The split is greedy by estimated run time, so no shard is left holding the slow files. The weights are seconds measured on one machine
// (docs/ci-timing.md); a file not listed counts as DEFAULT_WEIGHT. They only decide the balance, never what runs, so a stale number costs a little
// time and never coverage.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_WEIGHT = 1.5;
export const WEIGHTS = {
  "search-battery": 27, "vendor-backfill-cli": 21, "vendor-fetch": 19, "entity-media": 19, "venues": 17, "accounts": 15, "vendor-recent-first": 12,
  "vendor-lock": 11, "arabic-review": 11, "reports": 11, "ask-names-battery": 10, "scale": 9, "ask-battery": 8, "recap": 7, "vendor-load": 7,
  "unknown-facts": 6, "research-documents": 6, "night": 6, "search-exact": 6, "names-file": 6, "resolve": 4, "vendor-quirks-e2e": 4, "forum": 4,
  "finish-fit": 4, "vendor-preview-e2e": 4, "search-nl": 4,
};

const here = path.dirname(fileURLToPath(import.meta.url));

/** The test files, as `tests/<name>.test.ts`, sorted: exactly what `node --test tests/*.test.ts` would run. */
export function testFiles(root = path.join(here, "..")) {
  return fs.readdirSync(path.join(root, "tests")).filter((n) => n.endsWith(".test.ts")).sort().map((n) => `tests/${n}`);
}

/** Shard `index` (1-based) of `total`: longest files first, each to the lightest shard so far. Ties break by name, so the split is the same everywhere. */
export function shard(files, index, total) {
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(index) || index < 1 || index > total) throw new Error(`shard ${index} of ${total} is not a shard`);
  const weight = (f) => WEIGHTS[path.basename(f, ".test.ts")] ?? DEFAULT_WEIGHT;
  const load = new Array(total).fill(0);
  const out = Array.from({ length: total }, () => []);
  for (const f of [...files].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1))) {
    let s = 0;
    for (let i = 1; i < total; i++) if (load[i] < load[s]) s = i;
    load[s] += weight(f); out[s].push(f);
  }
  return out[index - 1].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = shard(testFiles(), Number(process.argv[2]), Number(process.argv[3]));
  if (files.length === 0) { console.error("an empty shard: refusing to run nothing"); process.exit(1); }
  console.log(files.join("\n"));
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LOAD_PATHS, summarise } from "../lib/loadtest";

test("latency summary: percentiles, throughput, and an empty run", () => {
  const s = summarise(Array.from({ length: 100 }, (_, i) => i + 1), 2);
  assert.deepEqual(s, { n: 100, reqPerSec: 50, p50: 51, p95: 96, p99: 100, max: 100 });
  assert.equal(summarise([1, 2, 3, 4, 5, 6, 7], 1).p50, 4, "the middle of seven is the fourth, not the fifth");
  assert.deepEqual(summarise([5], 1), { n: 1, reqPerSec: 1, p50: 5, p95: 5, p99: 5, max: 5 });
  assert.deepEqual(summarise([], 1), { n: 0, reqPerSec: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  assert.equal(summarise([3, 1, 2], 0).reqPerSec, 0, "no division by zero");
  const unsorted = [9, 1, 5]; summarise(unsorted, 1); assert.deepEqual(unsorted, [9, 1, 5], "the input is not reordered");
});

test("links do not prefetch unless a page asks for it", () => {
  // Every page is rendered per request, so a prefetch fetched only an empty shell: 215 background requests on the style map alone (measured)
  const src = fs.readFileSync(path.join(process.cwd(), "components/L.tsx"), "utf8");
  assert.match(src, /prefetch = false/);
  assert.match(src, /prefetch=\{prefetch\}/);
  assert.ok(!fs.existsSync(path.join(process.cwd(), "app")) || !fs.readdirSync(path.join(process.cwd(), "app"), { recursive: true }).some((f) => String(f).endsWith("loading.tsx")), "if a loading.tsx is ever added, prefetching has something to fetch: revisit the default");
  assert.ok(LOAD_PATHS.length > 10 && LOAD_PATHS.every((p) => p.startsWith("/")));
});

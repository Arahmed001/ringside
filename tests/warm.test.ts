import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { league } from "./league-sweep";

/**
 * What the start-up warm-up has to get right (round 31): that what it computes is what the pages will ask for, in the cache the pages read, and that
 * one step failing cannot skip the rest. How long a first visitor really waits is measured by `npm run coldcheck`, not here.
 */
const cleanupDb = tempDb("warm");
let cleanup = () => {};
after(() => { cleanup(); cleanupDb(); });
type World = Awaited<ReturnType<typeof league>>["w"];
let w: World;
before(async () => { const l = await league("sparse"); w = l.w; cleanup = l.cleanup; });

test("the memo cache is one cache however many copies of the module are loaded (Next bundles the start-up hook and the pages separately)", async () => {
  // two imports of the same file under different query strings are two module instances, as the instrumentation and page bundles are
  const copy = (tag: string) => import(`../lib/memo.ts?bundle=${tag}`) as Promise<typeof import("../lib/memo")>;
  const a = await copy("instrumentation"), b = await copy("page");
  assert.notEqual(a.memo, b.memo, "the test really has two copies of the module");
  const stub = {} as World;
  let computed = 0;
  assert.equal(a.memo(stub, "k", () => { computed++; return 41; }), 41);
  assert.equal(b.memo(stub, "k", () => { computed++; return 99; }), 41, "the second copy sees what the first computed instead of computing again");
  assert.equal(computed, 1);
  assert.deepEqual(b.memoKeys(stub), ["k"]);
  assert.deepEqual(a.memoKeys(stub), ["k"]);
  assert.deepEqual(a.memoKeys({} as World), [], "a different world has its own keys");
});

test("warming computes the keys the slow pages asked for when measured at 160,000 bouts, with the arguments they use", async () => {
  const { warmAggregates } = await import("../lib/warm");
  const { memoKeys } = await import("../lib/memo");
  const { LISTS } = await import("../lib/records");
  const { DIVISIONS } = await import("../lib/divisions");
  const { fightYears } = await import("../lib/fight-score");
  const { currentYear } = await import("../lib/clock");
  const results = await warmAggregates(w);
  assert.deepEqual(results.filter((r) => r.error), [], "no step failed on a league with one card");
  const keys = new Set(memoKeys(w));
  const want = [
    ...fightYears(w).map((y) => `fightsOfYear:${y}`), "bestFightsEver:25:", "belts", "careers",
    ...LISTS.map((l) => `record:${l.id}:::5`), ...LISTS.filter((l) => l.subject !== "bout").map((l) => `record:${l.id}:::10`),
    "accountability.record", "accountability.calls", "upsetRecord", "signalLift", "trainerImpact", "trainerMoves", "switchStudy", "underdogLifters", "recentTrainerChanges:9",
    "orgsRanking", "trainerLeaderboard:4",
    ...DIVISIONS.flatMap((d) => ["male", "female"].map((sex) => `divisionPool:${sex}:${d.name}`)),
    "overview", "byWeightClass", "methodSplit", "boutsPerYear", "finishHeat", "biggestUpsets:6:", "biggestUpsets:200:", `biggestUpsets:1:${currentYear() - 1}-01-01`, "countryLeaders", "stanceEdge", "reachEdge", "longestStreaks:6", "finishRoundHistogram",
    "moneyCoverage", "revenueByYear", "topGates:8", "topPpv:8", "topPurses:10", "topEarners:10:all", "broadcasterTable",
    "divisionWeights", "fightNightEdge", "missedWeights:12", "onThisDay:index",
  ];
  assert.deepEqual(want.filter((k) => !keys.has(k)), [], "each of these must be in the cache after warming, under the key the page uses");
});

test("the home page asks for the upset of the year by date, so the answer is cached (a spread copy of the world is a new object, and no key is ever found in it)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("app/[locale]/page.tsx", "utf8");
  assert.ok(/biggestUpsets\(w, 1, `\$\{currentYear\(\) - 1\}-01-01`\)/.test(src), "the home page uses the since argument");
  const offenders: string[] = [];
  const path = await import("node:path");
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
  for (const f of ["lib", "app", "components"].flatMap(walk)) if (/\{\s*\.\.\.(w|world)\s*[,}]/.test(fs.readFileSync(f, "utf8"))) offenders.push(f);
  assert.deepEqual(offenders, [], "a copy of the world defeats lib/memo.ts: pass the filter to the function (as `since` does) instead");
});

test("a step that fails is reported and the steps after it still run", async () => {
  const warm = await import("../lib/warm");
  const { memoKeys } = await import("../lib/memo");
  const { invalidateWorld, getWorld } = await import("../lib/world");
  invalidateWorld(); // a fresh world with an empty cache
  const fresh = await getWorld();
  assert.notEqual(fresh, w);
  const boom: [string, () => unknown] = ["boom", () => { throw new Error("the data was not what this step expected"); }];
  warm.WARM_STEPS.splice(1, 0, boom);
  try {
    const log: string[] = [];
    await warm.warmWorld((m) => log.push(m));
    assert.ok(log.some((m) => /world ready in \d+ ms/.test(m)));
    assert.ok(log.some((m) => /warm-up step "boom" failed \(the data was not what this step expected\)/.test(m)), log.join("\n"));
    assert.ok(log.some((m) => /pages warmed in \d+ ms/.test(m)));
    assert.ok(memoKeys(fresh).includes("topPurses:10"), "a step after the failing one ran");
    assert.ok(memoKeys(fresh).some((k) => k.startsWith("fightsOfYear:")), "and so did the one before it");
  } finally { warm.WARM_STEPS.splice(warm.WARM_STEPS.indexOf(boom), 1); }
});

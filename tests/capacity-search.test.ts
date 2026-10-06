import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

/**
 * docs/capacity.md: the palette search kept its indexes in module-level WeakMaps, so the copy the start-up warm-up filled was not the copy the API route
 * read (Next bundles them apart; the same bug lib/memo.ts documents), and the first search typed after every start paid 240-270 ms at 160,000 bouts.
 * The indexes now live in the registry every bundle shares. (The two-copies trick of tests/warm.test.ts does not make two copies here, so this checks
 * the registry directly: what is built is findable under the shared name, and a second ask returns the same object.)
 */
const cleanup = tempDb("capacity-search");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
before(async () => { w = await (await import("../lib/world")).getWorld(); });

const registry = () => (globalThis as unknown as { __ringsideShared?: Map<string, WeakMap<WeakKey, WeakMap<object, unknown>>> }).__ringsideShared;

test("the exact-match and near-spelling indexes are kept in the shared registry, once per world and table", async () => {
  const S = await import("../lib/search");
  const names = {};
  const a = S.exactOf(w, names), b = S.exactOf(w, {});
  assert.equal(a, b, "an empty table is one table, however it is passed");
  assert.equal(S.nearOf(w, names), S.nearOf(w, {}));
  const reg = registry();
  assert.ok(reg?.get("search.ts:exact")?.get(w), "the exact index is in the shared registry");
  assert.ok(reg?.get("search.ts:near")?.get(w), "the near-spelling index is in the shared registry");
});

test("the empty table the search uses is the one object lib/i18n/names.ts hands out for English", async () => {
  const { getNames } = await import("../lib/i18n/names");
  const S = await import("../lib/search");
  const en = await getNames("en");
  assert.equal(S.exactOf(w, {}), S.exactOf(w, en));
});

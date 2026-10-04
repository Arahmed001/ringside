import test from "node:test";
import assert from "node:assert/strict";
import { sharedWeakMap } from "../lib/memo";
import { NO_NAMES } from "../lib/i18n/names";

/**
 * Next compiles the start-up hook and the pages as separate bundles, so a module-level cache built at start-up is invisible to the pages. These caches live on
 * `globalThis` so a second copy of the module finds the first copy's. (A second copy cannot be made faithfully under tsx, so this checks the registry the copies share.)
 */
test("a shared weak map is found by name from anywhere, and each name is its own map", () => {
  const a = sharedWeakMap<object, number>("test:a"), again = sharedWeakMap<object, number>("test:a");
  assert.equal(a, again);
  assert.notEqual(a, sharedWeakMap<object, number>("test:b"));
  const key = {};
  a.set(key, 7);
  assert.equal(again.get(key), 7);
  const registry = (globalThis as unknown as { __ringsideShared: Map<string, unknown> }).__ringsideShared;
  assert.equal(registry.get("test:a"), a, "kept on globalThis, which every bundle shares");
});

test("the empty name table is one object for every copy of the module", () => {
  assert.equal((globalThis as unknown as { __ringsideNoNames: unknown }).__ringsideNoNames, NO_NAMES);
});

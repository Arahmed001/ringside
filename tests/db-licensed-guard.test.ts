import test, { after } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

/**
 * An empty database seeds itself on the first request from whatever provider is configured. For the demo league that is two seconds;
 * for a licensed feed it is thousands of paid requests started by a page view (or a health check). It must refuse and say what to do.
 */
const cleanup = tempDb("db-licensed-guard");
after(cleanup);
delete process.env.RINGSIDE_NO_SEED;
process.env.BOXING_PROVIDER = "licensed";
process.env.BOXING_API_KEY = "sk-test-key";
process.env.BOXING_API_STORAGE_CONFIRMED = "1";
const realFetch = globalThis.fetch;
let fetched = 0;
globalThis.fetch = (async () => { fetched++; throw new Error("the network must not be touched"); }) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

test("an empty database with a licensed provider refuses to seed, names the fix, and makes no request, every time it is asked", async () => {
  const { getDb } = await import("../lib/db");
  for (let i = 0; i < 3; i++) await assert.rejects(() => getDb(), (e: Error) => /npm run vendor:backfill/.test(e.message) && /docs\/real-data-runbook\.md/.test(e.message) && /empty/.test(e.message));
  assert.equal(fetched, 0, "nothing was fetched");
});

test("a script that loads its own data (RINGSIDE_NO_SEED) opens the same empty database fine", async () => {
  process.env.RINGSIDE_NO_SEED = "1";
  const g = globalThis as unknown as { __ringsideReady?: unknown };
  g.__ringsideReady = undefined;
  const { getDb } = await import("../lib/db");
  const db = await getDb();
  assert.equal((db.prepare("SELECT COUNT(*) c FROM boxers").get() as { c: number }).c, 0);
  assert.equal(fetched, 0);
});

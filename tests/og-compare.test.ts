import test, { after } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("og-compare");
after(cleanup);

/** The matchup card route draws only two different fighters that exist; anything else is a plain 404, so it cannot put chosen words on a Ringside card. */
const ask = async (qs: string) => (await import("../app/api/og/compare/route")).GET(new Request(`http://localhost/api/og/compare?${qs}`));

test("a request that is not two plausible slugs and a known language is refused before anything is drawn", async () => {
  for (const qs of ["", "a=x", "b=x", "a=Bad%20Slug&b=y", "a=x&b=<script>", `a=${"a".repeat(101)}&b=y`, "a=x&b=y&lang=fr", "a=x&b=y&lang=../../etc"]) {
    const r = await ask(qs);
    assert.equal(r.status, 404, qs);
    assert.equal(await r.text(), "Not found");
  }
});

test("two slugs that are well formed but belong to nobody are refused too, and so is a fighter against themselves", async () => {
  assert.equal((await ask("a=nobody&b=nobody-else&lang=en")).status, 404);
  assert.equal((await ask("a=nobody&b=nobody&lang=ar")).status, 404);
});

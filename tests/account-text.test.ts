import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * The words the account and report forms show are written in plain modules shared by client components. The Arabic dictionary sent to the browser only
 * holds strings the scanner calls "client" (a "use client" file, or anything under lib/). These lived under components/ and were not: every error message
 * and every field label on those forms came up in English on the Arabic site. This keeps them where the browser can translate them.
 */
test("every string in the shared form-wording modules is shipped to the browser in Arabic", async () => {
  const { extractKeys } = await import("../lib/i18n/extract");
  const { found } = extractKeys();
  for (const file of ["lib/account-text.ts", "lib/correction-text.ts"]) {
    const src = fs.readFileSync(file, "utf8");
    const keys = [...src.matchAll(/(?<![\w.$])t\(\s*"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1].replace(/\\"/g, '"'));
    assert.ok(keys.length > 10, `${file}: found its strings`);
    for (const k of keys) assert.equal(found.get(k)?.client, true, `${file}: "${k}" is not counted as a client string, so the browser would never get its Arabic`);
  }
});

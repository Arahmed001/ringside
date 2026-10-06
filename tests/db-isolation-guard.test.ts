import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * No test file may reach the repository's own demo database (\`data/ringside.db\`): in a fresh clone it does not exist and several processes creating it at once gave "database is locked"
 * (found overnight, in CI-like conditions: tests/smoke.test.ts imported lib/smoke, which reaches lib/db, before it called tempDb, and tests/seo-audit.test.ts never called tempDb at all).
 * A file that imports an app module that reaches lib/db must either import ./db-isolation first or call tempDb before any import of it (a dynamic import after the call).
 */
const dir = __dirname;
test("every test file that reaches the world or the database isolates its database before the app modules are imported", () => {
  const bad: string[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".test.ts"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    if (f === "db-isolation-guard.test.ts") continue;
    const reaches = /\bgetWorld\(|\bgetDb\(|\bingest\(/.test(src); // opens a database (importing a pure helper such as lib/smoke opens nothing)
    if (!reaches) continue;
    const uses = /tempDb\(|db-isolation|process\.env\.DATABASE_PATH\s*=/.test(src); // tempDb, the shared import, or setting the path to the file's own folder by hand
    if (!uses) { bad.push(`${f}: reaches the world or the database and never isolates it`); continue; }
    // a static import of an app module that reaches lib/db, above the isolation, is too early
    const lines = src.split("\n"), iso = lines.findIndex((l) => l.startsWith("import") && /db-isolation/.test(l));
    const firstStaticApp = lines.findIndex((l) => /^import .* from "\.\.\/lib\/(world|db|smoke|ingest|rankings|sitemap)"/.test(l) && !/^import type/.test(l));
    if (firstStaticApp >= 0 && !(iso >= 0 && iso < firstStaticApp)) bad.push(`${f}: statically imports an app module (line ${firstStaticApp + 1}) before the isolation`);
  }
  assert.deepEqual(bad, [], "isolate first: `import { cleanupIsolatedDb } from \"./db-isolation\"` as the first import, or `tempDb()` then dynamic imports");
});

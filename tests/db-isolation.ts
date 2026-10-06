import { tempDb } from "./helpers";

/**
 * For a test file that must import app modules at the top (statically): `lib/db.ts` reads the database path when it is first imported, and ES imports run before any code in
 * the file, so a `tempDb()` call placed after the imports comes too late and the file would use (and, in a fresh clone, create) the repository's own demo database.
 * Import this file FIRST: it runs \`tempDb\` while it is being imported, before the imports after it. \`import { cleanupIsolatedDb } from "./db-isolation"\`, then \`after(cleanupIsolatedDb)\`.
 */
export const cleanupIsolatedDb = tempDb("isolated");

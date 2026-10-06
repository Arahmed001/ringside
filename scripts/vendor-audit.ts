/**
 * npm run vendor:audit [-- --database FILE]
 * Checks a loaded database against what a good load looks like (lib/vendor-audit.ts): belts with a body, countries placed and spelled once, no card of only cancelled fights,
 * no amateur bouts, records the fights contradict marked disputed, and more. Read-only (the file is opened read-only), takes a second or two, needs no key and makes no request.
 * Exits 1 when a check FAILS, so it can sit after a load in a script. Default: ~/ringside-real/real.db (DATABASE_PATH when set).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { todayIso } from "../lib/clock";
import { auditDatabase, describeAudit, failed } from "../lib/vendor-audit";
import { DEFAULT_DATABASE } from "../lib/vendor-load";

const argv = process.argv.slice(2);
const i = argv.indexOf("--database");
const file = path.resolve((i > -1 ? argv[i + 1] : undefined) ?? process.env.DATABASE_PATH ?? DEFAULT_DATABASE);
if (!fs.existsSync(file)) { console.error(`There is no database at ${file}. Load one first (docs/load-day.md step 4) or point at one:  npm run vendor:audit -- --database FILE`); process.exit(1); }
const db = new DatabaseSync(file, { readOnly: true });
const checks = auditDatabase(db, todayIso());
db.close();
console.log(`vendor:audit  ${file}\n`);
for (const l of describeAudit(checks)) console.log(l);
process.exit(failed(checks).length ? 1 : 0);

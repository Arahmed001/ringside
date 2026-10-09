/**
 * npm run ship -- --database ~/ringside-real/real.db [--out ~/ringside-real/ship] [--allow-small]
 * Packs the finished database into a verified folder to upload to the host (docs/ship-database.md). Reads the database, writes only the new folder.
 */
import os from "node:os";
import path from "node:path";
import { shipDatabase } from "../lib/ship";

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv[i + 1] : undefined; };
const home = (p: string) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);
const database = path.resolve(home(flag("database") ?? process.env.DATABASE_PATH ?? "~/ringside-real/real.db"));
const out = path.resolve(home(flag("out") ?? path.join(path.dirname(database), "ship")));

const r = shipDatabase({ database, outRoot: out, minFighters: argv.includes("--allow-small") ? 0 : undefined });
if (r.problems.length) { console.log(`NOT PACKED:\n- ${r.problems.join("\n- ")}`); process.exit(1); }
console.log(`packed ${database}\n  into ${r.dir}\n  ringside.db  ${(r.bytes / 1048576).toFixed(0)} MB, integrity ok, checksums written: ${r.counts.join(", ")}`);
console.log(`\nNext (docs/ship-database.md, from step 3):\n  fly ssh sftp shell\n    mkdir /data/incoming\n    mkdir /data/incoming/${path.basename(r.dir)}\n    put ${path.join(r.dir, "ringside.db")} /data/incoming/${path.basename(r.dir)}/ringside.db\n    put ${path.join(r.dir, "checksums.sha256")} /data/incoming/${path.basename(r.dir)}/checksums.sha256`);

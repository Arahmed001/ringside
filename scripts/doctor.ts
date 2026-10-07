/**
 * npm run doctor [-- --production] [--json]
 * Checks the settings and the files they point to, before the first visitor: data folder writable, databases open and complete,
 * a recent backup, SITE_URL, keys, misspelt setting names. Reads .env.local / .env like the other scripts. Prints no secret.
 * Exit code: 1 if anything failed, 0 otherwise (warnings do not fail it unless --strict).
 * `--production` checks as if NODE_ENV=production (the shell you run it from usually does not have that set).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadEnv } from "../lib/i18n/translate";
import { diagnose, worst, type DbFacts, type Probe } from "../lib/doctor";
import { latestUpdate } from "../lib/freshness";
import { lastNightly } from "../lib/nightly-status";

const argv = process.argv.slice(2);
loadEnv();

const probe: Probe = {
  dir(p) {
    try { fs.accessSync(p, fs.constants.F_OK); } catch { return { exists: false, writable: false }; }
    try { fs.accessSync(p, fs.constants.W_OK); return { exists: true, writable: true }; } catch { return { exists: true, writable: false }; }
  },
  db(p, tables): DbFacts {
    if (!fs.existsSync(p)) return { exists: false };
    try {
      const st = fs.statSync(p);
      const db = new DatabaseSync(p, { readOnly: true });
      try {
        const quickCheck = String((db.prepare("PRAGMA quick_check").get() as Record<string, unknown>).quick_check);
        const have = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
        const rows: Record<string, number> = {};
        for (const t of tables) if (have.includes(t)) rows[t] = (db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get() as { c: number }).c;
        let editors: number | undefined; // optional: an older or minimal accounts file without these columns is still a readable file
        try { editors = (db.prepare("SELECT COUNT(*) c FROM users WHERE role IN ('editor','admin') AND disabled = 0").get() as { c: number }).c; } catch { /* no such column */ }
        return { exists: true, bytes: st.size, mode: st.mode, quickCheck, tables: have, rows, editors, lastUpdate: have.includes("ingest_runs") ? latestUpdate(db) : null };
      } finally { db.close(); }
    } catch (e) { return { exists: true, error: (e as Error).message.slice(0, 120) }; }
  },
  file: (p) => fs.existsSync(p),
  nightly: (dir) => lastNightly({ DATABASE_PATH: path.join(dir, "ringside.db") }),
  newestBackup(dir) {
    try {
      const stamps = fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/.test(n) && fs.existsSync(path.join(dir, n, "ringside.db")))
        .map((n) => new Date(n.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, "T$1:$2:$3Z"))).filter((d) => !Number.isNaN(d.getTime()));
      return stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : null;
    } catch { return null; }
  },
  freeBytes(p) {
    try { let d = p; while (!fs.existsSync(d) && path.dirname(d) !== d) d = path.dirname(d); const s = fs.statfsSync(d); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
  },
};

const findings = diagnose(process.env, probe, { production: argv.includes("--production") || process.env.NODE_ENV === "production" });
if (argv.includes("--json")) console.log(JSON.stringify(findings, null, 2));
else {
  const tag = { fail: "FAIL", warn: "WARN", info: "info", ok: "ok  " } as const;
  for (const x of findings) console.log(`${tag[x.level]}  ${x.message}${x.fix ? `\n      -> ${x.fix}` : ""}`);
  const n = (l: string) => findings.filter((x) => x.level === l).length;
  console.log(`\n${n("fail")} failed, ${n("warn")} warnings, ${n("info")} notes, ${n("ok")} fine.`);
}
const w = worst(findings);
process.exit(w === "fail" || (w === "warn" && argv.includes("--strict")) ? 1 : 0);

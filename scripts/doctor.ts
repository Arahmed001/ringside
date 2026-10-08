/**
 * npm run doctor [-- --production] [--json]
 * Checks the settings and the files they point to, before the first visitor: data folder writable, databases open and complete,
 * a recent backup, SITE_URL, keys, misspelt setting names. Reads .env.local / .env like the other scripts. Prints no secret.
 * Exit code: 1 if anything failed, 0 otherwise (warnings do not fail it unless --strict).
 * `--production` checks as if NODE_ENV=production (the shell you run it from usually does not have that set).
 */
import { loadEnv } from "../lib/i18n/translate";
import { diagnose, worst } from "../lib/doctor";
import { probe } from "../lib/doctor-probe";

const argv = process.argv.slice(2);
loadEnv();

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

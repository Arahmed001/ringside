/**
 * Read-only look at one fighter in the vendor cache: what the vendor said about them, every cached fight they are in (raw winner flags,
 * outcome, status, dates) and what the loader would count from it. For finding out why a career record does not add up.
 * No key, no network, no database.
 *
 *   npm run vendor:explain -- --name Acosta [--cache-dir <dir>]
 */
import fs from "node:fs";
import path from "node:path";
import { mapFight, type ApiFight, type ApiFighter, type Notes } from "../lib/providers/boxing-data-api";

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv[i + 1] : undefined; };
const name = arg("name")?.toLowerCase();
if (!name) { console.error("Say whom to look for: npm run vendor:explain -- --name Acosta"); process.exit(1); }
const dir = path.resolve(arg("cache-dir") ?? path.join(process.cwd(), "data", "vendor-cache", "boxing-data-api"));
if (!fs.existsSync(dir)) { console.error(`No cache at ${dir}. Run the same command from the folder where vendor:backfill ran, or pass --cache-dir.`); process.exit(1); }

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
const read = (f: string) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { data?: unknown }; } catch { return null; } };
const fighters = new Map<string, ApiFighter & { id?: string }>();
const fights = new Map<string, { fight: ApiFight; file: string }>();
for (const f of files) {
  const j = read(f); if (!j) continue;
  if (f.startsWith("v2-fighters-") && j.data && !Array.isArray(j.data)) { const d = j.data as ApiFighter & { id?: string }; fighters.set(d.id ?? f, d); }
  else if (f.startsWith("v2-fights") && Array.isArray(j.data)) for (const x of j.data as ApiFight[]) fights.set(x.id, { fight: x, file: f });
}
const nameOf = (x: ApiFighter) => { const r = x as ApiFighter & { full_name?: string }; return String(r.name ?? r.full_name ?? ""); };
const matches = [...fighters.values()].filter((x) => nameOf(x).toLowerCase().includes(name));
if (!matches.length) { console.log(`No cached fighter matches "${name}".`); process.exit(0); }

for (const m of matches) {
  console.log(`\n=== ${nameOf(m)}  id ${m.id}`);
  console.log("vendor record (stats):", JSON.stringify(m.stats ?? null));
  console.log("fighter record, raw  :", JSON.stringify(m));
  const mine = [...fights.values()].filter(({ fight }) => [fight.fighters?.fighter_1, fight.fighters?.fighter_2].some((s) => s?.fighter_id === m.id));
  console.log(`cached fights involving them: ${mine.length}`);
  for (const { fight, file } of mine) {
    const a = fight.fighters?.fighter_1, b = fight.fighters?.fighter_2;
    const side = (s: typeof a) => `${s?.full_name ?? s?.name ?? "?"} (${s?.fighter_id}) winner=${JSON.stringify(s?.winner)}`;
    console.log(`\n  fight ${fight.id}  [${file}]`);
    console.log(`    status ${fight.status}  fight date ${fight.date}  event date ${fight.event?.date}  event "${fight.event?.title}"`);
    console.log(`    fighter_1: ${side(a)}`);
    console.log(`    fighter_2: ${side(b)}`);
    console.log(`    results: ${JSON.stringify(fight.results ?? null)}  rounds ${fight.scheduled_rounds}`);
    const n = new Proxy({} as Notes, { get: (t, k) => (t as Record<string, number>)[k as string] ?? 0, set: (t, k, v) => { (t as Record<string, number>)[k as string] = v; return true; } });
    const mapped = mapFight(fight, n);
    const w = mapped?.bout.winnerExternalId;
    console.log(`    the loader counts: ${!mapped ? "skipped" : w === `bda-f-${m.id}` ? "a WIN for them" : w ? "a LOSS for them" : mapped.bout.method === "DRAW" ? "a draw" : "nothing (no result yet)"}`);
  }
}

/**
 * npm run post-load [-- --database FILE] [--out FILE] [--seed N] [--skip sample,speed,a11y,gallery] [--quick] [--build] [--keep-copy]
 *
 * The first real look at the league, after the vendor load: one self-contained HTML report (default ~/ringside-real/post-load-report.html) and a short summary here with PASS / WARN /
 * FAIL per section and a verdict line. Sections: 1 the audit and the doctor, 2 counts and completeness, 3 a sanity sample of 60 fighters through the real pages, 4 speed at real size,
 * 5 accessibility and layout, 6 a screenshot gallery, 7 surprises, 8 what to look at by hand.
 *
 * The database (default ~/ringside-real/real.db, or DATABASE_PATH) is only READ: this command copies it (with its -wal and -shm files) into a temporary folder, runs the analysis on the
 * copy and starts the app on the copy (the app writes: it migrates and warms). The original's size, time and checksum are compared before and after and the result is in the report.
 * The copy is deleted at the end (--keep-copy keeps it). No request leaves this machine except to the server it starts on 127.0.0.1; the vendor is never called and no key is read.
 * Needs a production build (`npm run build`, or --build) and, for sections 3 to 6, Playwright with Chromium (docs/accessibility.md; PLAYWRIGHT_MODULE points at it). Takes about ten minutes
 * on a league of 35,000 fighters; --skip leaves sections out, --quick shortens the browser and timing parts.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { todayIso } from "../lib/clock";
import { auditDatabase, type Check } from "../lib/vendor-audit";
import { DEFAULT_DATABASE } from "../lib/vendor-load";
import { diagnose, KNOWN_ENV, INTERNAL_ENV } from "../lib/doctor";
import type { Probe } from "../lib/doctor";
import { probe } from "../lib/doctor-probe";
import { DIVISIONS_HEAVIEST_FIRST } from "../lib/divisions";
import {
  countsSection, doctorRows, gatherCounts, gatherSampleStats, gatherSurprises, loadedRecords, nextSteps, redactor, renderReport, SKIPPED_BY_USER, sectionLevel, selectSample, surprisesSection, terminalSummary, verdict, n,
  type NextFacts, type Row, type Section,
} from "../lib/post-load";
import {
  a11ySection, a11ySweep, browseSample, checkSampleOverHttp, gallery, gallerySection, gatherTargets, loadPlaywright, machine, machineLabel, measureSpeed, representativePages, sampleSection, speedKinds, speedSection,
  killTree, minimalEnv, startServer, type A11yResult, type BrowserSample, type Server, type Shot,
} from "../lib/post-load-live";

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined; };
const has = (k: string) => argv.includes(`--${k}`);
const root = path.join(__dirname, "..");
const SEED = Number(arg("seed") ?? 24);
const skip = new Set((arg("skip") ?? "").split(",").filter(Boolean));
const quick = has("quick");
const t0 = Date.now();
const stamp = () => { const s = Math.round((Date.now() - t0) / 1000); return `[${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}]`; };
const say = (s: string) => console.log(`${stamp()} ${s}`);

const original = path.resolve(arg("database") ?? process.env.DATABASE_PATH ?? DEFAULT_DATABASE);
const outFile = path.resolve(arg("out") ?? path.join(path.dirname(original), "post-load-report.html"));
if (!fs.existsSync(original)) { console.error(`There is no database at ${original}. Load one first (docs/load-day.md step 4) or point at one:  npm run post-load -- --database FILE`); process.exit(2); }
if (fs.statSync(original).isDirectory()) { console.error(`${original} is a folder, not a database file.`); process.exit(2); }
const wantServer = ["sample", "speed", "a11y", "gallery"].some((s) => !skip.has(s));
if (wantServer && !fs.existsSync(path.join(root, ".next", "BUILD_ID")) && !has("build")) { console.error("There is no production build to serve. Run  npm run build  first, or add --build to this command (a minute or two), or --skip sample,speed,a11y,gallery to run only the data checks."); process.exit(2); }

/** Size, time and checksum of the database file and its write-ahead log, compared before and after to show the original was not touched. (The -shm file is only shared scratch memory for whoever has the database open; it is not data.) */
function fingerprint(file: string): string {
  return ["", "-wal"].map((ext) => {
    const f = file + ext;
    if (!fs.existsSync(f)) return `${ext || "db"}:absent`;
    const st = fs.statSync(f), h = crypto.createHash("sha256"), fd = fs.openSync(f, "r"), buf = Buffer.alloc(1 << 20);
    try { for (let r = fs.readSync(fd, buf, 0, buf.length, null); r > 0; r = fs.readSync(fd, buf, 0, buf.length, null)) h.update(buf.subarray(0, r)); } finally { fs.closeSync(fd); }
    return `${ext || "db"}:${st.size}:${st.mtimeMs}:${h.digest("hex")}`;
  }).join("|");
}

/** What is cleaned up however the command ends: the app it started and the copy it made. */
let liveServer: Server | null = null, liveTmp = "", keepCopy = false;
function cleanup() {
  if (liveServer) { killTree(liveServer.pid, "SIGKILL"); liveServer = null; }
  if (liveTmp && !keepCopy) { try { fs.rmSync(liveTmp, { recursive: true, force: true }); } catch { /* best effort */ } liveTmp = ""; }
}
process.on("exit", cleanup);

async function main() {
  const redact = redactor({ home: os.homedir(), tmp: [], env: process.env });
  const home = (p: string) => redact(p);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-postload-"));
  liveTmp = tmp; keepCopy = has("keep-copy");
  const copy = path.join(tmp, "league.db");
  const redactAll = redactor({ home: os.homedir(), tmp: [tmp], env: process.env });
  const today = todayIso();
  const m = machine();
  console.log(`post-load  ${home(original)}\n  The original is only read. Everything below runs on a copy in a temporary folder (the app writes to its database: it migrates and warms), which is deleted at the end.\n`);

  const before = fingerprint(original);
  for (const ext of ["", "-wal", "-shm"]) if (fs.existsSync(original + ext)) fs.copyFileSync(original + ext, copy + ext);
  say(`copied the database (${(fs.statSync(copy).size / 1048576).toFixed(0)} MB)`);

  // ---- 1. the audit and the doctor
  const db = new DatabaseSync(copy, { readOnly: true });
  const checks: Check[] = auditDatabase(db, today);
  say("audit done");
  const auditRows: Row[] = checks.map((c) => ({ level: c.level, label: `audit: ${c.title}`, detail: c.detail }));
  const known = new Set<string>([...KNOWN_ENV, ...INTERNAL_ENV]);
  const docEnv: Record<string, string | undefined> = Object.fromEntries(Object.entries(process.env).filter(([k]) => known.has(k)));
  // the doctor looks at the real folder (is it writable, is there a backup, is the disk full) but never opens a database there: each .db it is asked about is read from a temporary copy
  let copies = 0;
  const copying: Probe = { ...probe, db: (p, tables) => {
    if (!fs.existsSync(p)) return probe.db(p, tables);
    const c = path.join(tmp, `doctor-${copies++}.db`);
    for (const ext of ["", "-wal", "-shm"]) if (fs.existsSync(p + ext)) fs.copyFileSync(p + ext, c + ext);
    return probe.db(c, tables);
  } };
  const doctor = diagnose({ ...docEnv, DATABASE_PATH: original, BOXING_PROVIDER: "licensed" }, copying, { production: false });
  const doctorR = doctorRows(doctor);
  say("doctor done");

  // ---- 2. counts, 7. surprises, the sample and the targets (all read-only, on the copy)
  const counts = gatherCounts(db, today);
  const { section: countsSec } = countsSection(counts, today);
  say("counts done");
  const surprises = gatherSurprises(db, today);
  const surpriseSec = surprisesSection(surprises);
  say("surprises done");
  const stats = gatherSampleStats(db);
  const sample = selectSample(stats, SEED);
  const loaded = loadedRecords(db);
  const targets = gatherTargets(db, SEED);
  // fighters for the gallery: three with a photo and three without, best rated first
  const photoRows = db.prepare(`SELECT slug, name, (photo_url IS NOT NULL AND photo_url <> '') OR EXISTS (SELECT 1 FROM boxer_media m WHERE m.boxer_id = boxers.id AND m.status = 'matched') AS photo FROM boxers WHERE EXISTS (SELECT 1 FROM bouts b WHERE b.red_id = boxers.id OR b.blue_id = boxers.id) ORDER BY rating DESC, id LIMIT 4000`).all() as { slug: string; name: string; photo: number }[];
  const withPhoto = photoRows.filter((r) => r.photo).slice(0, 3), without = photoRows.filter((r) => !r.photo).slice(0, 6 - Math.min(3, photoRows.filter((r) => r.photo).length));
  const galleryFighters = [...withPhoto, ...without].slice(0, 6);
  const dispute = sample.find((s) => s.group === "disputed"), few = sample.find((s) => s.group === "few");
  const boutRow = db.prepare("SELECT id FROM bouts WHERE method IS NOT NULL ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
  const topOf = (division: string): string[] => (db.prepare("SELECT name FROM boxers WHERE weight_class = ? AND COALESCE(sex,'male') = 'male' ORDER BY rating DESC LIMIT 5").all(division) as { name: string }[]).map((r) => r.name);
  const populated = DIVISIONS_HEAVIEST_FIRST.map((d) => d.name).filter((d) => topOf(d).length > 0);
  const facts: NextFacts = {
    photoShare: counts.fighters ? counts.photo / counts.fighters : 0, arabicShare: counts.fighters ? counts.arabic / counts.fighters : 0, wikidataShare: counts.fighters ? counts.wikidata / counts.fighters : 0,
    heaviest: populated.length ? { division: populated[0], top: topOf(populated[0]) } : undefined, lightest: populated.length > 1 ? { division: populated[populated.length - 1], top: topOf(populated[populated.length - 1]) } : undefined,
    disputedExample: dispute?.name, arabicExample: targets.top ? `/ar/boxers/${targets.top}` : undefined,
  };
  db.close();

  // ---- 3 to 6 need the app
  let server: Server | null = null, serverError = "";
  let sampleSec: Section, speedSec: Section, a11ySec: Section, gallerySec: Section;
  const sampleOnly = sample.map((s) => s.slug);
  const skipped = (id: string, number: number, title: string): Section => ({ id, number, title, level: "skip", summary: SKIPPED_BY_USER, rows: [{ level: "skip", label: title, detail: "left out with --skip" }], blocks: [] });
  try {
    if (wantServer) {
      if (has("build") && !fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
        say("building the app (a minute or two)");
        const b = spawnSync(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"], { cwd: root, encoding: "utf8", env: { ...minimalEnv(process.env), DATABASE_PATH: copy, ACCOUNTS_DB_PATH: path.join(tmp, "accounts.db"), BOXING_PROVIDER: "licensed", RINGSIDE_NO_SEED: "1", NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production" } });
        if (b.status !== 0) throw new Error(`the build failed (exit ${b.status}): ${(b.stderr || b.stdout).split("\n").slice(-6).join(" | ")}`);
      }
      say("starting the app on the copy");
      server = await startServer({ root, database: copy, accounts: path.join(tmp, "accounts.db"), logFile: path.join(tmp, "server.log"), env: minimalEnv(process.env) });
      liveServer = server;
      say(`the app answered after ${(server.startMs / 1000).toFixed(1)} s (${n(server.health.fighters)} fighters)`);
    }
  } catch (e) { serverError = (e as Error).message; say(`could not run the app: ${serverError.split("\n")[0]}`); }

  const fail = (id: string, number: number, title: string, why: string): Section => ({ id, number, title, level: "fail", summary: why.split("\n")[0], rows: [{ level: "fail", label: title, detail: why }], blocks: [] });
  const pw = server && (!skip.has("sample") || !skip.has("a11y") || !skip.has("gallery")) ? await loadPlaywright() : null;
  const noPw = "Playwright is not installed or has no browser (npm i -g playwright && npx playwright install chromium, or set PLAYWRIGHT_MODULE; docs/accessibility.md)";

  // 3
  if (skip.has("sample")) sampleSec = skipped("sample", 3, "Sanity sample");
  else if (!server) sampleSec = fail("sample", 3, "Sanity sample", `the app did not start: ${serverError}`);
  else {
    say("sanity sample: 60 fighters over HTTP");
    const dbR = new DatabaseSync(copy, { readOnly: true });
    const http = await checkSampleOverHttp(server.base, sample, dbR, loaded);
    dbR.close();
    let browser: BrowserSample[] | null = null;
    if (pw) { say("sanity sample: the same fighters in a real browser"); try { browser = await browseSample(pw, server.base, quick ? sampleOnly.slice(0, 20) : sampleOnly); } catch (e) { say(`browser failed: ${(e as Error).message.split("\n")[0]}`); } }
    sampleSec = sampleSection(http, browser, pw ? "the browser could not run" : noPw);
  }

  // 4
  if (skip.has("speed")) speedSec = skipped("speed", 4, "Speed at real size");
  else if (!server) speedSec = fail("speed", 4, "Speed at real size", `the app did not start: ${serverError}`);
  else {
    say("speed: timing nine kinds of page");
    const r = await measureSpeed(server.base, server.pid, speedKinds(targets, SEED), { serial: quick ? 5 : 12, concurrent: quick ? 12 : 36, concurrency: 4, seed: SEED });
    speedSec = speedSection(server, r, m);
  }

  // 5
  let a11yResults: A11yResult[] | null = null;
  if (skip.has("a11y")) a11ySec = skipped("a11y", 5, "Accessibility and layout");
  else if (!server) a11ySec = fail("a11y", 5, "Accessibility and layout", `the app did not start: ${serverError}`);
  else if (!pw) a11ySec = a11ySection(null, noPw);
  else {
    say("accessibility sweep (this is the long one)");
    try {
      a11yResults = await a11ySweep(pw, server.base, root, representativePages(targets, { disputed: dispute?.slug, few: few?.slug, bout: boutRow?.id ?? null }), quick ? [375] : [375, 1280], quick ? ["en"] : ["en", "ar"], say);
      a11ySec = a11ySection(a11yResults);
    } catch (e) { a11ySec = a11ySection(null, `the sweep could not run: ${(e as Error).message.split("\n")[0]}`); }
  }

  // 6
  let shots: { shots: Shot[]; dropped: number } | null = null;
  if (skip.has("gallery")) gallerySec = skipped("gallery", 6, "Screenshot gallery");
  else if (!server) gallerySec = fail("gallery", 6, "Screenshot gallery", `the app did not start: ${serverError}`);
  else if (!pw) gallerySec = gallerySection(null, { photo: 0, silhouette: 0 }, noPw);
  else {
    say("screenshots");
    const pages = [{ label: "home", path: "/" }, ...galleryFighters.map((f, i) => ({ label: `fighter ${i + 1} (${f.photo ? "photo" : "silhouette"}) ${f.name}`, path: `/boxers/${f.slug}` })),
      ...(targets.divisions[0] ? [{ label: "a division", path: `/rankings/${targets.divisions[0]}` }] : []), ...(targets.latestEvent ? [{ label: "an event", path: `/events/${targets.latestEvent}` }] : []),
      ...(targets.countries[0] ? [{ label: "a country", path: `/countries/${targets.countries[0]}` }] : []), { label: "the data page", path: "/data" }];
    try { shots = await gallery(pw, server.base, quick ? pages.slice(0, 4) : pages, say); } catch (e) { say(`screenshots failed: ${(e as Error).message.split("\n")[0]}`); }
    gallerySec = gallerySection(shots, { photo: galleryFighters.filter((f) => f.photo).length, silhouette: galleryFighters.filter((f) => !f.photo).length }, "the screenshots could not be taken");
  }

  // the server's log is the one place an error inside a page would show that the browser cannot see
  let serverErrors: string[] = [];
  if (server) {
    // the app's own start-up lines about settings (a copy run with no key logs the missing key at error level on every start) are not errors of a page
    try { serverErrors = fs.readFileSync(server.logFile, "utf8").split("\n").filter((l) => /"level":"error"|world rebuild failed|Unhandled|TypeError|ReferenceError/.test(l) && !/"event":"config_problem"/.test(l)); } catch { /* no log */ }
    await server.stop(); liveServer = null;
    say("the app stopped");
  }
  if (server && serverErrors.length) {
    const host = sampleSec.level === "skip" ? speedSec : sampleSec;
    host.rows.push({ level: "warn", label: "server log", detail: `${serverErrors.length} error line(s) in the app's log while it served this report, the first: ${serverErrors[0].slice(0, 240)} (the log is deleted with the copy; run npm run vendor:site -- --start to look at the live log)` });
    host.level = sectionLevel(host.rows);
  }

  // ---- the copy goes; the original is shown to be as it was
  if (has("keep-copy")) say(`the copy was kept at ${tmp}`); else { fs.rmSync(tmp, { recursive: true, force: true }); liveTmp = ""; }
  const after = fingerprint(original);
  const untouched = before === after;
  const sec1rows: Row[] = [
    { level: untouched ? "pass" : "fail", label: "the original database was not touched", detail: untouched ? `size, modification time and SHA-256 of ${home(original)} (and its write-ahead log) are the same before and after, and it was never opened as a database, only copied; the analysis, the doctor's database checks and the app ran on copies${has("keep-copy") ? "" : ", which are now deleted"}` : "the database file changed while this ran: another process wrote to it (a fetch or an update?). That is not this command, which only reads it; run it again when nothing else is writing." },
    ...auditRows, ...doctorR,
  ];
  const auditSec: Section = { id: "audit", number: 1, title: "Audit and doctor", level: sectionLevel(sec1rows), rows: sec1rows, blocks: [], summary: `${checks.filter((c) => c.level === "fail").length} audit fail, ${checks.filter((c) => c.level === "warn").length} audit warn; doctor: ${doctor.filter((d) => d.level === "fail").length} fail, ${doctor.filter((d) => d.level === "warn").length} warn` };

  const sections: Section[] = [auditSec, countsSec, sampleSec, speedSec, a11ySec, gallerySec, surpriseSec];
  const nextSec: Section = { id: "next", number: 8, title: "What to look at by hand", level: "info", summary: "from this run's findings and section 4 of the runbook", rows: [], blocks: [{ kind: "examples", title: "In this order", lines: nextSteps(sections, facts) }] };
  sections.push(nextSec);
  const v = verdict(sections);

  const headLines = [`post-load report for ${home(original)}`, `${n(counts.fighters)} fighters, ${n(counts.bouts)} bouts, ${n(counts.events)} events, checked on ${today}`, `machine: ${machineLabel(m)}; seed ${SEED}`, `elapsed: ${Math.round((Date.now() - t0) / 1000)} s (timings in section 4 share this machine with other work: read them as upper estimates)`];
  const plainTail = [`Report: ${home(outFile)}`, "Original database: read only, " + (untouched ? "unchanged" : "CHANGED during the run")];
  const plain = terminalSummary(sections, v, headLines, plainTail).map(redactAll);
  const html = renderReport(sections, v, {
    title: "Ringside post-load report", generated: `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, sourceLabel: home(original),
    headline: headLines.slice(1),
    notes: ["Read-only: the database was copied to a temporary folder; the analysis and the app ran on the copy and the copy was deleted. The original's checksum before and after is compared in section 1.",
      "No key was read and nothing was sent anywhere: the only network traffic is between this tool and the app it started on 127.0.0.1. Fighter names, records and dates are what the public site would show.",
      `Fonts are the system's (the report is one file with no outside resources); colours follow DESIGN.md. Seed ${SEED}: the same league gives the same sample.`,
      "Levels: PASS = checked and fine; WARN = read it; FAIL = something is wrong; SKIP = could not run (counts as WARN in the verdict); NOTE = information only.",
      "Thresholds are in lib/post-load-live.ts (LIMITS) and the reference timings are from docs/capacity.md."],
  }, redactAll, plain);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html);
  console.log("\n" + plain.join("\n"));
  console.log(`\n(report: ${(html.length / 1048576).toFixed(1)} MB, ${Math.round((Date.now() - t0) / 1000)} s)`);
  process.exit(v.level === "fail" ? 1 : 0);
}
process.on("SIGINT", () => { cleanup(); process.exit(130); });
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });

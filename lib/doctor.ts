/**
 * The configuration doctor: "will this deployment do what I think it will?", answered before the first visitor rather than after.
 *
 * Two layers. `envFindings` reads only settings (so the server can run it at start-up without touching a disk); `fileFindings` also
 * looks at the files those settings point to, through a `Probe` so a test can describe any disk without making one. The script
 * (scripts/doctor.ts) supplies the real probe. Nothing here prints a secret: a finding about a key says that it is missing, short or
 * odd, never what it is.
 *
 * Levels: `fail` = the app will not work as intended; `warn` = it works but probably not how you meant; `info` = a choice worth knowing
 * about; `ok` = checked and fine.
 */
import { httpsUrl, siteContact } from "./site-info";
import { siteUrlIsPublic } from "./seo";
import path from "node:path";
import { assertPlausibleKey } from "./providers/boxing-data-api";
import { CLOCK_SLACK_HOURS, STALE_DATA_DAYS } from "./freshness";

export type Level = "fail" | "warn" | "info" | "ok";
export interface Finding { level: Level; id: string; message: string; fix?: string }
export type Env = Record<string, string | undefined>;

export const MIN_NODE = [22, 5] as const;
/** Free space below which a database that grows (or a backup) is at risk. */
export const LOW_DISK = 500 * 1024 * 1024, CRITICAL_DISK = 100 * 1024 * 1024;
/** A backup older than this (in days) is "not running" as far as a daily schedule is concerned. */
export const STALE_BACKUP_DAYS = 2;
export { STALE_DATA_DAYS };

/** Every setting the app, its scripts and its docs know about. The drift test (tests/config-docs.test.ts) keeps this, the code and .env.example in step. */
export const KNOWN_ENV = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_MODEL_TRANSLATE", "AI_DAILY_BUDGET", "AI_CLIENT_LIMIT", "AI_CLIENT_WINDOW_MS",
  "BOXING_PROVIDER", "BOXING_FILE", "BOXING_API_URL", "BOXING_API_KEY", "BOXING_API_MAX_REQUESTS", "BOXING_API_PER_HOUR", "BOXING_API_SINCE", "BOXING_API_STORAGE_CONFIRMED", "PUBLIC_API", "VENDOR_REDISTRIBUTION_CONFIRMED",
  "VENDOR_LAG_DAYS", "VENDOR_LOAD_LAG_DAYS", "RINGSIDE_KEY_FILE", "WIKIMEDIA_CONTACT", "WIKIMEDIA_GAP_MS", "WIKIDATA_GAP_MS", "MEDIA_RESOLVER", "MEDIA_RESOLVER_BATCH",
  "RESEARCH_CONTACT", "SITE_CONTACT", "VENDOR_TERMS_URL", "VENDOR_RANKINGS_CONFIRMED", "RESEARCH_DELAY_MS", "RESEARCH_BLOCKLIST", "SITE_URL", "INDEXABLE", "DATABASE_PATH", "ACCOUNTS_DB_PATH",
  "RINGSIDE_NOW",
] as const;
/** Settings that exist for tests and tooling and are deliberately not in .env.example. */
export const INTERNAL_ENV = ["I18N_DIR", "REVIEW_OUT", "RINGSIDE_LOCK_DIR", "RINGSIDE_NO_SEED", "RINGSIDE_MEMO_LOG", "WIKIPEDIA_API_URL", "RESEARCH_DIR", "PLAYWRIGHT_MODULE"] as const;
/** Edit distance, for "did you mean". Cheap, and only ever run on a handful of names. */
export function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const f = (level: Level, id: string, message: string, fix?: string): Finding => ({ level, id, message, ...(fix ? { fix } : {}) });
const set = (env: Env, k: string) => (env[k] ?? "").trim() !== "";
const provider = (env: Env) => (env.BOXING_PROVIDER ?? "demo").trim() || "demo";

export const isProduction = (env: Env) => env.NODE_ENV === "production";

/** Settings only: nothing here touches a disk or the network, so it is safe to run at every start-up. */
export function envFindings(env: Env, nodeVersion = process.versions.node, production = isProduction(env)): Finding[] {
  const out: Finding[] = [];

  const [maj, min] = nodeVersion.split(".").map(Number);
  if (maj < MIN_NODE[0] || (maj === MIN_NODE[0] && min < MIN_NODE[1])) out.push(f("fail", "node", `Node ${nodeVersion} is too old: the database layer (node:sqlite) needs ${MIN_NODE.join(".")} or newer.`, "Use the Node version in .nvmrc / the Dockerfile base image."));
  else out.push(f("ok", "node", `Node ${nodeVersion}.`));

  const p = provider(env);
  if (!["demo", "licensed", "file"].includes(p)) out.push(f("fail", "provider", `BOXING_PROVIDER=${p} is not one of demo, licensed, file.`, "Set it to one of those three, or remove it for the demo league."));
  else out.push(f("info", "provider", p === "demo" ? "Data: the fictional demo league." : p === "file" ? "Data: a JSON feed file." : "Data: the licensed vendor feed (read from the database; the app never fetches it on a page view)."));

  if (p === "file" && !set(env, "BOXING_FILE")) out.push(f("fail", "file-feed", "BOXING_PROVIDER=file but BOXING_FILE is not set.", "Set BOXING_FILE to the feed's path."));
  if (p === "licensed") {
    if (!set(env, "BOXING_API_KEY")) out.push(f("fail", "api-key", "BOXING_PROVIDER=licensed but BOXING_API_KEY is not set, so no load or daily update can run.", "docs/real-data-runbook.md"));
    else {
      try { assertPlausibleKey((env.BOXING_API_KEY ?? "").trim()); out.push(f("ok", "api-key", "BOXING_API_KEY is set and looks like a key.")); }
      catch { out.push(f("fail", "api-key", "BOXING_API_KEY is set but does not look like a key (a space, an accent, an ellipsis, or too short): a placeholder was probably pasted.", "Set the real key without quoting it from a document.")); }
    }
    const s = env.BOXING_API_STORAGE_CONFIRMED;
    if (s === "0") out.push(f("warn", "storage", "BOXING_API_STORAGE_CONFIRMED=0: storing the vendor's data is switched off, so the first load and the daily update will refuse to run.", "Unset it to store provisionally, or set 1 once the vendor has confirmed in writing."));
    else if (s === "1") out.push(f("ok", "storage", "Storing the vendor's data is confirmed in writing."));
    else out.push(f("info", "storage", "Storing the vendor's data is provisional (no written confirmation recorded). Every load says so.", "Set BOXING_API_STORAGE_CONFIRMED=1 once the vendor has confirmed."));
  }

  if (env.INDEXABLE === "1" && p === "demo") out.push(f("warn", "indexable", "INDEXABLE=1 with the demo league: search engines will be invited to index fictional fighters and results as if they were real.", "Remove INDEXABLE, or load real data first."));
  else if (production && p === "demo") out.push(f("info", "indexable", "Production with the demo league: pages are marked noindex (correct for fictional data)."));

  const site = (env.SITE_URL ?? "").trim();
  if (!site) {
    if (production) out.push(f("warn", "site-url", "SITE_URL is not set: canonical links, sitemaps, share images and the sign-in origin check would use http://localhost:3000, so the site stays noindex (robots.txt disallows everything, no sitemap) until it is set.", "Set SITE_URL to the public origin, e.g. https://ringside.example."));
  } else {
    let u: URL | null = null;
    try { u = new URL(site); } catch { /* reported below */ }
    if (!u || !/^https?:$/.test(u.protocol)) out.push(f("fail", "site-url", "SITE_URL is not a web address (it needs http:// or https://).", "Use the public origin, e.g. https://ringside.example."));
    else {
      if (production && u.protocol !== "https:") out.push(f("warn", "site-url", "SITE_URL is not https: the session cookie is not marked Secure and HSTS is not sent.", "Put TLS in front and use the https address."));
      if (u.pathname !== "/" || u.search || u.hash) out.push(f("warn", "site-url", "SITE_URL has a path, query or fragment; it should be only the origin (scheme, host, port).", `Use ${u.origin}`));
      if (production && /^(localhost|127\.|\[::1\])/.test(u.hostname)) out.push(f("warn", "site-url", "SITE_URL points at this machine: shared links and canonical URLs will not work for anyone else, and the site stays noindex."));
    }
  }

  if (set(env, "ANTHROPIC_API_KEY")) {
    out.push(f("ok", "ai", env.AI_DAILY_BUDGET === "0" ? "ANTHROPIC_API_KEY is set but AI_DAILY_BUDGET=0 turns the model off: the rule-based answers are used." : "ANTHROPIC_API_KEY is set: model-written answers are on, within AI_DAILY_BUDGET and the per-visitor limit."));
  } else out.push(f("info", "ai", "No ANTHROPIC_API_KEY: search, scouting reports, previews and /ask use the built-in rules. Everything works; the text is plainer."));
  for (const k of ["AI_DAILY_BUDGET", "AI_CLIENT_LIMIT", "AI_CLIENT_WINDOW_MS", "RESEARCH_DELAY_MS", "WIKIMEDIA_GAP_MS", "WIKIDATA_GAP_MS", "BOXING_API_MAX_REQUESTS", "BOXING_API_PER_HOUR", "VENDOR_LAG_DAYS", "VENDOR_LOAD_LAG_DAYS", "MEDIA_RESOLVER_BATCH"]) {
    if (set(env, k) && !(Number.isFinite(Number(env[k])) && Number(env[k]) >= 0)) out.push(f("fail", `number-${k}`, `${k} must be a number of 0 or more; the app ignores it and uses the default.`, `Fix or remove ${k}.`));
  }
  if (set(env, "BOXING_API_SINCE") && !/^\d{4}-\d{2}-\d{2}$/.test(env.BOXING_API_SINCE!.trim())) out.push(f("fail", "since", "BOXING_API_SINCE must be a date like 2000-01-01."));

  const contactOk = (v?: string) => !!v && /@|^https?:\/\//.test(v.trim());
  if (env.MEDIA_RESOLVER === "wikimedia" && !contactOk(env.WIKIMEDIA_CONTACT)) out.push(f("fail", "wikimedia-contact", "MEDIA_RESOLVER=wikimedia but WIKIMEDIA_CONTACT is not an email or web address; Wikimedia asks bots to identify themselves and the resolver refuses to run without one.", "Set it to a web address (the repository URL is fine) or an email you are happy to publish."));
  if (!set(env, "RESEARCH_CONTACT")) out.push(f("info", "research-contact", "RESEARCH_CONTACT is not set: `npm run research` will not run, and reviewers' \"check the source\" on community edits answers \"unavailable\" (it goes in the fetcher's User-Agent)."));
  else if (!contactOk(env.RESEARCH_CONTACT)) out.push(f("warn", "research-contact", "RESEARCH_CONTACT is neither an email nor a web address, so the polite fetcher will refuse to start.", "Use an email or an https:// address."));
  // what a public site owes its readers once it shows real data: somewhere to report a mistake, and the vendor's terms
  if (!set(env, "SITE_CONTACT")) { if (p === "licensed") out.push(f("warn", "site-contact", "SITE_CONTACT is not set, so people who are not signed in have nowhere to report a mistake about a real person.", "Set it to a role address or an https:// page you are happy to publish (it is shown on the Data and Report pages).")); }
  else if (!siteContact(env)) out.push(f("warn", "site-contact", "SITE_CONTACT is neither an email address nor an https:// address, so the site shows no contact.", "Use an address like corrections@example.com, or an https:// page."));
  if (p === "licensed") {
    // the sanctioning bodies' lists come "from BoxingScene" through the vendor: left out until the owner says the vendor's answer allows them
    if (env.VENDOR_RANKINGS_CONFIRMED?.trim() === "1") out.push(f("info", "official-rankings", "VENDOR_RANKINGS_CONFIRMED=1: the official IBF, WBA, WBC and WBO lists are fetched, stored and shown, credited to the vendor and BoxingScene. This is your statement that the vendor's written answer allows it."));
    else out.push(f("info", "official-rankings", "The official IBF, WBA, WBC and WBO lists are left out (not fetched, and not shown even if stored) until you set VENDOR_RANKINGS_CONFIRMED=1, your statement that the vendor's answer on storing and showing them (docs/boxing-data-api-rankings-enquiry.md) allows it."));
    if (!set(env, "VENDOR_TERMS_URL")) out.push(f("info", "vendor-terms", "VENDOR_TERMS_URL is not set: the Data page credits the vendor but links no licence terms. Set it once the vendor's terms (or its written agreement) are public."));
    else if (!httpsUrl(env.VENDOR_TERMS_URL)) out.push(f("warn", "vendor-terms", "VENDOR_TERMS_URL is not an https:// address, so it is not shown.", "Use the https:// link to the vendor's terms."));
    // the public API and the embeds hand the vendor's records to other sites: off for a licensed feed until the owner has both asked for them and stated that the terms allow it
    if (env.PUBLIC_API === "1" && env.VENDOR_REDISTRIBUTION_CONFIRMED !== "1") out.push(f("warn", "public-api", "PUBLIC_API=1, but the public API and the embeds stay off for a licensed feed until you state that the vendor's terms allow redistribution.", "Set VENDOR_REDISTRIBUTION_CONFIRMED=1 only when that is true (docs/public-api.md)."));
    else if (env.PUBLIC_API !== "1" && env.VENDOR_REDISTRIBUTION_CONFIRMED === "1") out.push(f("info", "public-api", "VENDOR_REDISTRIBUTION_CONFIRMED=1 is set but PUBLIC_API is not, so the public API and the embeds are off.", "Set PUBLIC_API=1 to turn them on."));
  }
  if (set(env, "PORT") && !(Number.isInteger(Number(env.PORT)) && Number(env.PORT) > 0 && Number(env.PORT) < 65536)) out.push(f("fail", "port", "PORT is not a port number."));

  // A misspelt name is silently ignored: the one failure that looks exactly like "I set it and nothing happened".
  // Only near misses are reported (other tools' variables, like ANTHROPIC_BASE_URL, are none of our business).
  const known = new Set<string>([...KNOWN_ENV, ...INTERNAL_ENV]);
  for (const k of Object.keys(env)) {
    if (known.has(k) || k.length < 6) continue;
    const near = [...known].map((n) => [n, distance(k.toUpperCase(), n)] as const).sort((x, y) => x[1] - y[1])[0];
    if (near && near[1] <= 2) out.push(f("warn", `unknown-${k}`, `${k} is not a setting this app reads. Did you mean ${near[0]}?${k.toUpperCase() === near[0] ? " (setting names are case-sensitive)" : ""}`, "A misspelt setting is ignored without any error."));
  }
  return out;
}

export interface DbFacts { exists: boolean; bytes?: number; mode?: number; quickCheck?: string; tables?: string[]; rows?: Record<string, number>; error?: string; /** the newest load or update of the sports data (lib/freshness.ts) */ lastUpdate?: { at: string; provider: string } | null }
export interface Probe {
  dir(p: string): { exists: boolean; writable: boolean };
  db(p: string, tables: string[]): DbFacts;
  file(p: string): boolean;
  /** Newest backup folder's time, or null when there are none. */
  newestBackup(dir: string): Date | null;
  freeBytes(p: string): number | null;
}

export const SPORTS_TABLES = ["boxers", "events", "bouts"], ACCOUNT_TABLES = ["users", "sessions", "picks"];

const paths = (env: Env, cwd: string) => {
  const db = env.DATABASE_PATH?.trim() || path.join(cwd, "data", "ringside.db");
  return { db, accounts: env.ACCOUNTS_DB_PATH?.trim() || path.join(path.dirname(db), "accounts.db"), backups: path.join(path.dirname(db), "backups") };
};

/** Settings plus the files they point to. */
export function fileFindings(env: Env, probe: Probe, o: { cwd?: string; now?: Date; production?: boolean } = {}): Finding[] {
  const cwd = o.cwd ?? process.cwd(), now = o.now ?? new Date(), production = o.production ?? isProduction(env);
  const p = paths(env, cwd), prov = provider(env);
  const out: Finding[] = [];

  const dir = probe.dir(path.dirname(p.db));
  if (!dir.exists) out.push(f("warn", "data-dir", `The data folder ${path.dirname(p.db)} does not exist yet; it is created on first start if its parent allows.`, "Mount the persistent volume there."));
  else if (!dir.writable) out.push(f("fail", "data-dir", `The data folder ${path.dirname(p.db)} is not writable by this user: the database, accounts and backups cannot be written.`, "Fix the volume's owner or the container's user."));
  else out.push(f("ok", "data-dir", `Data folder ${path.dirname(p.db)} is writable.`));

  const sports = probe.db(p.db, SPORTS_TABLES);
  if (!sports.exists) {
    if (prov === "licensed") out.push(f("fail", "sports-db", `${p.db} does not exist and BOXING_PROVIDER=licensed: the app will not start (it never fetches a history on a page view).`, "Fill it first: npm run vendor:backfill (docs/real-data-runbook.md)."));
    else if (prov === "file") out.push(f("info", "sports-db", `${p.db} does not exist yet: it is built from the feed file at first start.`));
    else out.push(f("info", "sports-db", `${p.db} does not exist yet: the demo league is created at first start.`));
  } else if (sports.error || (sports.quickCheck && sports.quickCheck !== "ok")) {
    out.push(f("fail", "sports-db", `${p.db} cannot be read cleanly (${sports.error ?? sports.quickCheck}).`, "Restore the newest verified backup: npm run backup -- verify <folder>."));
  } else {
    const missing = SPORTS_TABLES.filter((t) => !(sports.tables ?? []).includes(t));
    if (missing.length) out.push(f("fail", "sports-db", `${p.db} is missing the table(s) ${missing.join(", ")}: it is not a Ringside database.`, "Check DATABASE_PATH points at the right file."));
    else if (!(sports.rows?.bouts ?? 0)) out.push(f(prov === "licensed" ? "fail" : "warn", "sports-db", `${p.db} has no fights in it.`, prov === "licensed" ? "Run npm run vendor:backfill." : undefined));
    else out.push(f("ok", "sports-db", `${p.db}: ${sports.rows?.boxers ?? 0} boxers, ${sports.rows?.bouts} fights, integrity ok.`));
    // a licensed feed is kept current by a daily job; when it stops, the site goes on answering with old results and nothing fails
    if (prov === "licensed" && (sports.rows?.bouts ?? 0) > 0) {
      const at = sports.lastUpdate?.at ? Date.parse(sports.lastUpdate.at) : NaN;
      if (!Number.isFinite(at)) out.push(f("warn", "stale-data", "No load or update of the fights is recorded in this database.", "Run npm run vendor:backfill, then schedule `npm run vendor:backfill -- --update` daily."));
      else {
        const days = (now.getTime() - at) / 86_400_000;
        if (days < -CLOCK_SLACK_HOURS / 24) out.push(f("warn", "stale-data", `The last update of the fights is dated ${sports.lastUpdate!.at.slice(0, 10)}, which has not happened yet: this machine's clock was wrong when the update ran (or is wrong now), so the age of the data cannot be told and a stopped daily update would not show.`, "Fix the machine's clock (turn on network time), then run the update once by hand: npm run vendor:backfill -- --update."));
        else if (days > STALE_DATA_DAYS) out.push(f("warn", "stale-data", `The fights were last updated ${Math.floor(days)} days ago (${sports.lastUpdate!.at.slice(0, 10)}): the daily update is probably not running, and the site is showing old results.`, "Check the scheduled `npm run vendor:backfill -- --update` and its log (docs/real-data-runbook.md)."));
        else out.push(f("ok", "stale-data", `The fights were last updated ${sports.lastUpdate!.at.slice(0, 10)}.`));
      }
    }
  }

  const acc = probe.db(p.accounts, ACCOUNT_TABLES);
  if (!acc.exists) out.push(f("info", "accounts-db", `${p.accounts} does not exist yet: it is created with the first sign-up.`));
  else if (acc.error || (acc.quickCheck && acc.quickCheck !== "ok")) out.push(f("fail", "accounts-db", `${p.accounts} cannot be read cleanly (${acc.error ?? acc.quickCheck}).`, "Restore the newest verified backup."));
  else {
    out.push(f("ok", "accounts-db", `${p.accounts}: ${acc.rows?.users ?? 0} accounts, integrity ok.`));
    if (acc.mode !== undefined && (acc.mode & 0o077) !== 0) out.push(f("warn", "accounts-perms", `${p.accounts} is readable by other users on this machine (mode ${(acc.mode & 0o777).toString(8)}); it holds password hashes and people's picks.`, `chmod 600 ${p.accounts}`));
  }
  if (acc.exists && path.dirname(p.accounts) !== path.dirname(p.db) && !env.ACCOUNTS_DB_PATH) out.push(f("info", "accounts-dir", "Accounts are in a different folder from the sports database."));

  const last = probe.newestBackup(p.backups);
  if (!last) out.push(f(production ? "warn" : "info", "backup", `No backup found in ${p.backups}.`, "Schedule `npm run backup` daily and copy the folder off this disk (docs/deploy.md, Backups)."));
  else {
    const days = (now.getTime() - last.getTime()) / 86_400_000;
    if (days > STALE_BACKUP_DAYS) out.push(f("warn", "backup", `The newest backup is ${Math.floor(days)} days old (${last.toISOString().slice(0, 10)}): the schedule is probably not running.`, "Check the scheduled `npm run backup`."));
    else out.push(f("ok", "backup", `Newest backup is from ${last.toISOString().slice(0, 10)}.`));
  }

  if (prov === "file" && set(env, "BOXING_FILE") && !probe.file(env.BOXING_FILE!.trim())) out.push(f("fail", "file-feed", `BOXING_FILE ${env.BOXING_FILE} does not exist.`, "Fix the path."));

  const free = probe.freeBytes(path.dirname(p.db));
  if (free !== null) {
    const mb = Math.round(free / 1024 / 1024);
    if (free < CRITICAL_DISK) out.push(f("fail", "disk", `Only ${mb} MB free beside the database: a write can fail at any moment.`, "Free space or grow the volume."));
    else if (free < LOW_DISK) out.push(f("warn", "disk", `${mb} MB free beside the database; a backup is a full copy of both databases.`, "Grow the volume before it fills."));
    else out.push(f("ok", "disk", `${mb} MB free beside the database.`));
  }
  return out;
}

export const diagnose = (env: Env, probe: Probe, o: { cwd?: string; now?: Date; production?: boolean; nodeVersion?: string } = {}): Finding[] =>
  [...envFindings(env, o.nodeVersion, o.production ?? isProduction(env)), ...fileFindings(env, probe, o)];

export const worst = (fs: Finding[]): Level => (["fail", "warn", "info", "ok"] as const).find((l) => fs.some((x) => x.level === l)) ?? "ok";

/** Only the origin of a web address: a password pasted into SITE_URL by mistake must not reach a log. */
const origin = (v?: string) => { try { return v?.trim() ? new URL(v.trim()).origin : null; } catch { return "(not a web address)"; } };

/** The one line the server logs at start-up: what it was configured to do (never a secret), as JSON like the error lines. */
export function configLine(env: Env, at = new Date()): string {
  const fs = envFindings(env, process.versions.node, isProduction(env));
  return JSON.stringify({
    at: at.toISOString(), level: "info", event: "config", node: process.versions.node, env: env.NODE_ENV ?? "development", provider: provider(env),
    siteUrl: origin(env.SITE_URL), indexable: (env.INDEXABLE === "1" || provider(env) !== "demo") && siteUrlIsPublic(env.SITE_URL),
    ai: set(env, "ANTHROPIC_API_KEY") && env.AI_DAILY_BUDGET !== "0", problems: fs.filter((x) => x.level === "fail" || x.level === "warn").map((x) => x.id),
  });
}

/** One line per fail/warn, for the log: the message and the fix, never a value of a secret setting. */
export const problemLines = (env: Env, at = new Date()): string[] =>
  envFindings(env, process.versions.node, isProduction(env)).filter((x) => x.level === "fail" || x.level === "warn")
    .map((x) => JSON.stringify({ at: at.toISOString(), level: x.level === "fail" ? "error" : "warn", event: "config_problem", id: x.id, message: x.message, fix: x.fix }));

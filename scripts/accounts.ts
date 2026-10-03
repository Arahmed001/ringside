/**
 * Operator tools for the accounts database (run on the server; they are not reachable from the website).
 *   npm run accounts -- list                       users, roles, picks and contributions
 *   npm run accounts -- role NAME user|editor|admin
 *   npm run accounts -- disable NAME | enable NAME   a disabled user is signed out and cannot sign in or appear on the leaderboard
 *   npm run accounts -- reset NAME                 a one-time code (valid an hour) for someone who forgot their password; hand it to them
 *   npm run accounts -- audit [N]                  the last N audit entries (default 30)
 *   npm run accounts -- check                      integrity check, counts, and expired sessions waiting to be cleared
 *   npm run accounts -- purge                      delete expired sessions and reset codes
 *   npm run accounts -- apply                      replay approved community edits and accepted corrections into the sports database (ratings are recomputed if a result changed)
 *   npm run accounts -- owner NAME BOXER [--url URL]... [--note TEXT]   record that this account is that fighter (or authorised by them), after you have checked out of band; --url is the fighter's own official page
 *   npm run accounts -- unowner NAME BOXER         remove that link
 *   npm run accounts -- owners                     who is linked to which fighter
 * ACCOUNTS_DB_PATH / DATABASE_PATH decide which files; the same values as the server.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { accountsDb, accountsPath } from "../lib/accounts/store";
import { issueResetCode, purgeExpired, setDisabled, setRole, type Role } from "../lib/accounts/users";
import { applyContributions } from "../lib/accounts/contributions";
import { applyCorrections, linkOwner, unlinkOwner } from "../lib/accounts/corrections";
import { recomputeRatings } from "../lib/ingest";

const [cmd, a, b] = process.argv.slice(2);
const db = accountsDb();
console.log(`accounts database: ${accountsPath()}`);

if (cmd === "list") {
  const rows = db.prepare(`SELECT u.username, u.role, u.disabled, u.created_at, u.last_login,
    (SELECT COUNT(*) FROM picks p WHERE p.user_id = u.id) picks, (SELECT COUNT(*) FROM contributions c WHERE c.user_id = u.id) contributions, (SELECT COUNT(*) FROM reports r WHERE r.user_id = u.id) reports FROM users u ORDER BY u.id`).all();
  console.table(rows);
} else if (cmd === "role") {
  if (!a || !["user", "editor", "admin"].includes(b)) { console.error("usage: role NAME user|editor|admin"); process.exit(2); }
  console.log(setRole(a, b as Role, db) ? `${a} is now ${b}` : `no user named ${a}`);
} else if (cmd === "disable" || cmd === "enable") {
  console.log(a && setDisabled(a, cmd === "disable", db) ? `${a} ${cmd}d` : `no user named ${a}`);
} else if (cmd === "reset") {
  const code = a ? issueResetCode(a, db) : null;
  console.log(code ? `one-time code for ${a} (valid 1 hour; they enter it on the account page): ${code}` : `no user named ${a}`);
} else if (cmd === "audit") {
  console.table(db.prepare("SELECT at, actor, action, target, detail FROM audit ORDER BY id DESC LIMIT ?").all(Number(a) || 30));
} else if (cmd === "check") {
  const one = (q: string) => (db.prepare(q).get() as Record<string, number | string>);
  const integrity = String((one("PRAGMA integrity_check") as { integrity_check: string }).integrity_check);
  console.table({ integrity, users: one("SELECT COUNT(*) c FROM users").c, disabled: one("SELECT COUNT(*) c FROM users WHERE disabled = 1").c, picks: one("SELECT COUNT(*) c FROM picks").c,
    pendingEdits: one("SELECT COUNT(*) c FROM contributions WHERE status = 'pending'").c, openReports: one("SELECT COUNT(*) c FROM reports WHERE status = 'open' AND kind = 'error'").c,
    openAboutMe: one("SELECT COUNT(*) c FROM reports WHERE status = 'open' AND kind = 'about_me'").c, correctionsToReview: one("SELECT COUNT(*) c FROM reports WHERE state = 'vendor_changed'").c, liveSessions: one(`SELECT COUNT(*) c FROM sessions WHERE expires_at >= '${new Date().toISOString()}'`).c,
    expiredSessions: one(`SELECT COUNT(*) c FROM sessions WHERE expires_at < '${new Date().toISOString()}'`).c });
  process.exit(integrity === "ok" ? 0 : 1);
} else if (cmd === "purge") {
  console.log(purgeExpired(db));
} else if (cmd === "apply") {
  const main = new DatabaseSync(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db"));
  main.exec("PRAGMA foreign_keys = ON");
  console.log(applyContributions(main, db));
  const fixed = applyCorrections(main, db);
  console.log("corrections:", fixed);
  if (fixed.boutsChanged) { recomputeRatings(main); console.log("ratings recomputed"); }
} else if (cmd === "owner" || cmd === "unowner" || cmd === "owners") {
  const main = new DatabaseSync(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db"));
  const operator = { id: 0, username: "operator", role: "admin" as Role, createdAt: "", picksPublic: false };
  if (cmd === "owners") {
    console.table(db.prepare("SELECT u.username, o.boxer_ext, o.verified_by, o.verified_at, o.official_urls, o.note FROM boxer_owners o JOIN users u ON u.id = o.user_id ORDER BY o.verified_at").all());
  } else if (!a || !b) { console.error(`usage: ${cmd} NAME BOXER${cmd === "owner" ? " [--url URL]... [--note TEXT]" : ""}`); process.exit(2); }
  else if (cmd === "unowner") console.log(unlinkOwner(operator, a, b, main, db) ? `${a} is no longer linked to ${b}` : `${a} was not linked to ${b}`);
  else {
    const rest = process.argv.slice(5), urls: string[] = []; let note: string | undefined;
    for (let i = 0; i < rest.length; i++) { if (rest[i] === "--url") urls.push(rest[++i] ?? ""); else if (rest[i] === "--note") note = rest[++i]; else { console.error(`unknown option ${rest[i]}`); process.exit(2); } }
    const r = linkOwner(operator, a, b, { urls, note }, main, db);
    if (!r.ok) { console.error({ user_unknown: `no user named ${a}`, boxer_unknown: `no fighter with slug or id ${b}`, url_invalid: "a --url is not a valid https address", forbidden: "not allowed" }[r.error]); process.exit(1); }
    console.log(`${a} is now the verified owner of ${r.boxerName} (${r.boxerExt}): their own corrections to fighter details apply at once${urls.length ? `; sources under ${urls.join(", ")} count as the fighter's own` : ""}`);
  }
} else { console.error("usage: list | role | disable | enable | reset | audit | check | purge | apply | owner | unowner | owners (see the header of scripts/accounts.ts)"); process.exit(2); }

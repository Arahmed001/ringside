/**
 * Operator tools for the accounts database (run on the server; they are not reachable from the website).
 *   npm run accounts -- list                       users, roles, picks and contributions
 *   npm run accounts -- role NAME user|editor|admin
 *   npm run accounts -- disable NAME | enable NAME   a disabled user is signed out and cannot sign in or appear on the leaderboard
 *   npm run accounts -- reset NAME                 a one-time code (valid an hour) for someone who forgot their password; hand it to them
 *   npm run accounts -- audit [N]                  the last N audit entries (default 30)
 *   npm run accounts -- check                      integrity check, counts, and expired sessions waiting to be cleared
 *   npm run accounts -- purge                      delete expired sessions and reset codes
 *   npm run accounts -- apply                      replay approved community edits into the sports database
 * ACCOUNTS_DB_PATH / DATABASE_PATH decide which files; the same values as the server.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { accountsDb, accountsPath } from "../lib/accounts/store";
import { issueResetCode, purgeExpired, setDisabled, setRole, type Role } from "../lib/accounts/users";
import { applyContributions } from "../lib/accounts/contributions";

const [cmd, a, b] = process.argv.slice(2);
const db = accountsDb();
console.log(`accounts database: ${accountsPath()}`);

if (cmd === "list") {
  const rows = db.prepare(`SELECT u.username, u.role, u.disabled, u.created_at, u.last_login,
    (SELECT COUNT(*) FROM picks p WHERE p.user_id = u.id) picks, (SELECT COUNT(*) FROM contributions c WHERE c.user_id = u.id) contributions FROM users u ORDER BY u.id`).all();
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
    pendingEdits: one("SELECT COUNT(*) c FROM contributions WHERE status = 'pending'").c, liveSessions: one(`SELECT COUNT(*) c FROM sessions WHERE expires_at >= '${new Date().toISOString()}'`).c,
    expiredSessions: one(`SELECT COUNT(*) c FROM sessions WHERE expires_at < '${new Date().toISOString()}'`).c });
  process.exit(integrity === "ok" ? 0 : 1);
} else if (cmd === "purge") {
  console.log(purgeExpired(db));
} else if (cmd === "apply") {
  const main = new DatabaseSync(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db"));
  main.exec("PRAGMA foreign_keys = ON");
  console.log(applyContributions(main, db));
} else { console.error("usage: list | role | disable | enable | reset | audit | check | purge | apply (see the header of scripts/accounts.ts)"); process.exit(2); }

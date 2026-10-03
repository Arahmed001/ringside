/**
 * Operator tools for the accounts database (run on the server; they are not reachable from the website).
 *   npm run accounts -- list                       users, roles, picks and contributions
 *   npm run accounts -- role NAME user|editor|admin
 *   npm run accounts -- disable NAME | enable NAME   a disabled user is signed out and cannot sign in or appear on the leaderboard
 *   npm run accounts -- reset NAME                 a one-time code (valid an hour) for someone who forgot their password; hand it to them
 *   npm run accounts -- audit [N]                  the last N audit entries (default 30)
 *   npm run accounts -- apply                      replay approved community edits into the sports database
 * ACCOUNTS_DB_PATH / DATABASE_PATH decide which files; the same values as the server.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { accountsDb, accountsPath } from "../lib/accounts/store";
import { issueResetCode, setDisabled, setRole, type Role } from "../lib/accounts/users";
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
} else if (cmd === "apply") {
  const main = new DatabaseSync(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db"));
  main.exec("PRAGMA foreign_keys = ON");
  console.log(applyContributions(main, db));
} else { console.error("usage: list | role | disable | enable | reset | audit | apply (see the header of scripts/accounts.ts)"); process.exit(2); }

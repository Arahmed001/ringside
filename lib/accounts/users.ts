import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { accountsDb, audit, nowIso } from "./store";
import { dummyHash, hashPassword, needsRehash, passwordProblems, verifyPassword } from "./password";

export type Role = "user" | "editor" | "admin";
export interface User { id: number; username: string; role: Role; createdAt: string; picksPublic: boolean }
export const SESSION_DAYS = 30;
export const SESSION_COOKIE = "rs_session";

/** Names are 3 to 24 letters, digits and underscores (no spaces, no look-alike tricks), unique ignoring case. */
export const USERNAME = /^[A-Za-z0-9_]{3,24}$/;
const RESERVED = new Set(["admin", "administrator", "root", "ringside", "system", "moderator", "editor", "support", "staff", "model", "null", "undefined", "anonymous", "you"]);

export type SignupError = "username_invalid" | "username_taken" | "username_reserved" | "password_short" | "password_long" | "password_common" | "password_username" | "password_same_char";

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const rowToUser = (r: Record<string, unknown>): User => ({ id: r.id as number, username: r.username as string, role: r.role as Role, createdAt: r.created_at as string, picksPublic: !!r.picks_public });

export async function createUser(username: string, password: string, db: DatabaseSync = accountsDb()): Promise<{ user: User } | { error: SignupError }> {
  if (typeof username !== "string" || !USERNAME.test(username)) return { error: "username_invalid" };
  if (RESERVED.has(username.toLowerCase())) return { error: "username_reserved" };
  const bad = passwordProblems(password, username);
  if (bad.length) return { error: `password_${bad[0]}` as SignupError };
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) return { error: "username_taken" };
  const hash = await hashPassword(password);
  try {
    const r = db.prepare("INSERT INTO users (username, pw_hash, created_at) VALUES (?,?,?) RETURNING id, username, role, created_at, picks_public").get(username, hash, nowIso()) as Record<string, unknown>;
    audit(db, username, "signup", username);
    return { user: rowToUser(r) };
  } catch { return { error: "username_taken" }; } // lost a race with the same name
}

/** Checks a password. Always does the hashing work, even for a name that does not exist, so timing does not reveal which names are taken. */
export async function checkLogin(username: string, password: string, db: DatabaseSync = accountsDb()): Promise<User | null> {
  const row = typeof username === "string" && USERNAME.test(username) ? db.prepare("SELECT * FROM users WHERE username = ?").get(username) as Record<string, unknown> | undefined : undefined;
  const ok = await verifyPassword(typeof password === "string" ? password.slice(0, 400) : "", row ? (row.pw_hash as string) : await dummyHash());
  if (!row || !ok || row.disabled) return null;
  if (needsRehash(row.pw_hash as string)) db.prepare("UPDATE users SET pw_hash = ? WHERE id = ?").run(await hashPassword(password), row.id as number);
  db.prepare("UPDATE users SET last_login = ? WHERE id = ?").run(nowIso(), row.id as number);
  return rowToUser(row);
}

/** A new session: returns the secret to put in the cookie. Only its hash is stored, so a copy of the database cannot be used to sign in. */
export function createSession(userId: number, db: DatabaseSync = accountsDb(), now = Date.now()): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(now + SESSION_DAYS * 86400000);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date(now).toISOString());
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)").run(sha(token), userId, new Date(now).toISOString(), expires.toISOString());
  return { token, expires };
}

export function userForToken(token: string | undefined, db: DatabaseSync = accountsDb(), now = Date.now()): User | null {
  if (!token || token.length > 100) return null;
  const r = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`).get(sha(token), new Date(now).toISOString()) as Record<string, unknown> | undefined;
  return r ? rowToUser(r) : null;
}

export const endSession = (token: string | undefined, db: DatabaseSync = accountsDb()) => { if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token)); };
export const endAllSessions = (userId: number, db: DatabaseSync = accountsDb()) => { db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId); };

/** Changing the password signs every other device out (the caller starts a fresh session for this one). */
export async function changePassword(userId: number, current: string, next: string, db: DatabaseSync = accountsDb()): Promise<"ok" | "wrong_password" | SignupError> {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as Record<string, unknown> | undefined;
  if (!row || !(await verifyPassword(typeof current === "string" ? current.slice(0, 400) : "", row.pw_hash as string))) return "wrong_password";
  const bad = passwordProblems(next, row.username as string);
  if (bad.length) return `password_${bad[0]}` as SignupError;
  db.prepare("UPDATE users SET pw_hash = ? WHERE id = ?").run(await hashPassword(next), userId);
  endAllSessions(userId, db);
  audit(db, row.username as string, "password_change", row.username as string);
  return "ok";
}

/** Deleting an account removes the person, their picks and their sessions. Their contributions stay (the data they added was published under a source), with no name on them. */
export async function deleteUser(userId: number, password: string, db: DatabaseSync = accountsDb()): Promise<boolean> {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as Record<string, unknown> | undefined;
  if (!row || !(await verifyPassword(typeof password === "string" ? password.slice(0, 400) : "", row.pw_hash as string))) return false;
  db.prepare("DELETE FROM users WHERE id = ?").run(userId); // cascades to sessions, resets, picks; contributions keep their rows with user_id NULL
  audit(db, null, "account_deleted", `user#${userId}`);
  return true;
}

export const setPicksPublic = (userId: number, on: boolean, db: DatabaseSync = accountsDb()) => { db.prepare("UPDATE users SET picks_public = ? WHERE id = ?").run(on ? 1 : 0, userId); };

// ---- maintenance, from scripts/accounts.ts (an operator on the server, not the website) ----
export function setRole(username: string, role: Role, db: DatabaseSync = accountsDb()): boolean {
  const r = db.prepare("UPDATE users SET role = ? WHERE username = ?").run(role, username);
  if (r.changes) audit(db, "operator", "role", username, role);
  return r.changes > 0;
}
export function setDisabled(username: string, disabled: boolean, db: DatabaseSync = accountsDb()): boolean {
  const u = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number } | undefined;
  if (!u) return false;
  db.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, u.id);
  if (disabled) endAllSessions(u.id, db);
  audit(db, "operator", disabled ? "disable" : "enable", username);
  return true;
}

/** One-time code for a person who forgot their password (there is no email on file to send one to). Valid for an hour; the operator hands it over. */
export function issueResetCode(username: string, db: DatabaseSync = accountsDb(), now = Date.now()): string | null {
  const u = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number } | undefined;
  if (!u) return null;
  const code = crypto.randomBytes(12).toString("base64url");
  db.prepare("DELETE FROM resets WHERE user_id = ?").run(u.id);
  db.prepare("INSERT INTO resets (token_hash, user_id, expires_at) VALUES (?,?,?)").run(sha(code), u.id, new Date(now + 3600_000).toISOString());
  audit(db, "operator", "reset_issued", username);
  return code;
}

export async function redeemResetCode(username: string, code: string, password: string, db: DatabaseSync = accountsDb(), now = Date.now()): Promise<"ok" | "invalid" | SignupError> {
  const u = typeof username === "string" && USERNAME.test(username) ? db.prepare("SELECT id, username FROM users WHERE username = ?").get(username) as { id: number; username: string } | undefined : undefined;
  const r = u && typeof code === "string" && code.length < 100 ? db.prepare("SELECT 1 x FROM resets WHERE token_hash = ? AND user_id = ? AND expires_at > ?").get(sha(code), u.id, new Date(now).toISOString()) : undefined;
  if (!u || !r) return "invalid";
  const bad = passwordProblems(password, u.username);
  if (bad.length) return `password_${bad[0]}` as SignupError;
  db.prepare("UPDATE users SET pw_hash = ? WHERE id = ?").run(await hashPassword(password), u.id);
  db.prepare("DELETE FROM resets WHERE user_id = ?").run(u.id);
  endAllSessions(u.id, db);
  audit(db, u.username, "reset_used", u.username);
  return "ok";
}

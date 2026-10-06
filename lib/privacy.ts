import type { World } from "./world";
import { memo } from "./memo";
import { msg } from "./i18n/t";

/**
 * What the site keeps and sends, declared in one place so the privacy page (/privacy) and its tests read the same thing. The page says only what is
 * here, and tests/privacy.test.ts checks this against the code: a new browser storage key, a table or column in the accounts database, a place that
 * sends text to the model, or a cookie anywhere else fails a test until it is declared here (and so shown on the page).
 */

/** The browser's own storage: nothing leaves the browser, nothing is read by the server. */
export const STORAGE_KEYS: { key: string; what: string }[] = [
  { key: "ringside:picks", what: msg("your pick’em picks, until you sign in (then they move to your account)") },
  { key: "ringside:watchlist", what: msg("the fighters on your watchlist, until you sign in (then they move to your account)") },
  { key: "ringside:watchseen", what: msg("the day you last looked at your watchlist, so it can show what is new since (on this device only, never sent anywhere)") },
  { key: "ringside-nav", what: msg("whether the side menu is open or collapsed") },
];

/** Every table of the accounts database, with what is in it for the person (the page's second list). Columns are checked against the real schema. */
export const HELD: Record<string, { columns: string[]; what: string }> = {
  users: { columns: ["id", "username", "pw_hash", "role", "created_at", "last_login", "disabled", "picks_public", "picks_seen_through"], what: msg("your name, a salted hash of your password (never the password), when you joined and last signed in, whether you are on the leaderboard, and the date up to which you have seen your graded picks") },
  sessions: { columns: ["token_hash", "user_id", "created_at", "expires_at", "label", "last_seen"], what: msg("where you are signed in: a hash of the sign-in token, the dates, and a coarse device label such as “<c>Chrome on macOS</c>” (nothing else the browser sends)") },
  resets: { columns: ["token_hash", "user_id", "expires_at"], what: msg("a one-time sign-in code the operator issued you, as a hash, if you asked for one") },
  picks: { columns: ["user_id", "bout_ext", "boxer_ext", "picked_at"], what: msg("your picks: which fighter you chose in which fight, and when") },
  watchlist: { columns: ["user_id", "boxer_ext", "added_at"], what: msg("the fighters on your watchlist, and when you added each, once you are signed in") },
  contributions: { columns: ["id", "user_id", "kind", "boxer_ext", "role", "person_name", "start_date", "end_date", "source_url", "quote", "note", "status", "created_at", "reviewed_by", "reviewed_at", "review_note", "source_check", "source_checked_at"], what: msg("trainer and manager changes you proposed, with the link and the words you quoted") },
  reports: { columns: ["id", "user_id", "kind", "target_type", "target_ext", "field", "shown_value", "proposed_value", "source_url", "quote", "note", "contact", "status", "created_at", "reviewed_by", "reviewed_at", "review_note", "source_check", "source_checked_at", "by_owner", "state", "original_value", "vendor_value", "applied_at"], what: msg("reports of a wrong fact you sent, including the contact you chose to give with them") },
  boxer_owners: { columns: ["user_id", "boxer_ext", "verified_by", "verified_at", "note", "official_urls"], what: msg("a fighter an administrator linked to your account as yours, after checking out of band") },
  audit: { columns: ["id", "at", "actor", "action", "target", "detail"], what: msg("a log of account and review actions (sign-ups, password changes, decisions on proposals and reports), naming the people involved") },
};

/** Every place that sends text to the model provider when a key is configured, and exactly what is in it. A test fails if `claude(` is called anywhere else. */
export const AI_USES: { files: string[]; what: string }[] = [
  { files: ["lib/ai.ts"], what: msg("the words you type into the fighter search, so they can be turned into filters; and a scouting report, built from a fighter’s record") },
  { files: ["lib/ask/index.ts"], what: msg("the question you type into Ask the data, and the figures the database returned for it") },
  { files: ["lib/preview.ts"], what: msg("the facts about an upcoming fight, to write its preview") },
];

/** The websites other than this one that a visitor's browser may be told to fetch pictures from: where fighter photos, event posters and the pictures of logos, belts and venues live in the data. */
export function pictureHosts(w: World): string[] {
  return memo(w, "pictureHosts", () => {
    const hosts = new Set<string>();
    const add = (u: string | null | undefined) => { if (u && /^https?:\/\//i.test(u)) { try { hosts.add(new URL(u).host); } catch { /* not a URL */ } } };
    for (const b of w.boxers) add(b.photoUrl);
    for (const e of w.events) add(e.posterUrl);
    for (const p of w.pictureList) add(p.url);
    return [...hosts].sort();
  });
}

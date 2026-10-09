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
  forum_threads: { columns: ["id", "kind", "subject_ext", "title", "user_id", "created_at", "last_post_at", "post_count", "locked", "hidden"], what: msg("the forum threads you started: the title (on the general board; it is cleared if you delete your account), the fighter or fight it is about, and when; the thread under a fighter or a fight is made by the first post written there") },
  forum_posts: { columns: ["id", "thread_id", "user_id", "body", "fingerprint", "created_at", "edited_at", "status", "hidden_by", "hidden_at", "hidden_reason", "wave_fp", "withdrawn_body", "withdrawn_at", "appeal_at", "appeal_result"], what: msg("what you wrote in the forum: the words, when, any edit, and two hashes of the words that are used to refuse the same post twice in a day, from you or from several accounts; if you delete a post that had been hidden or reported, the words are kept for the editors for 90 days; if a post of yours was hidden by reports and you asked for a review, when you asked and the outcome; deleting your account wipes the words, including any kept for the editors, and leaves the empty place, so the replies still read") },
  forum_reports: { columns: ["id", "post_id", "user_id", "reason", "note", "status", "created_at", "reviewed_by", "reviewed_at"], what: msg("the forum posts you reported and why, with any note you added (the note is cleared if you delete your account)") },
  social_posts: { columns: ["id", "provider", "post_id", "url", "subject_kind", "subject_ext", "account", "note", "added_by", "added_at"], what: msg("the public posts an editor chose to show, with where each shows and which editor added it (nothing about visitors)") },
  proposals: { columns: ["id", "source", "kind", "target_key", "label", "old_json", "new_json", "evidence_json", "fingerprint", "status", "first_seen", "last_seen", "decided_by", "decided_at", "note"], what: msg("changes to our data that a public source seems to have made, waiting for an administrator to accept or reject them: what changes, where it was read, and which administrator decided and when (nothing a reader wrote)") },
  licensed_images: { columns: ["id", "boxer_slug", "image_url", "licence", "licence_url", "credit", "source_url", "evidence", "added_by", "added_at"], what: msg("the pictures an editor recorded, each with its licence or permission, credit and source, and which editor added it (nothing about visitors)") },
  audit: { columns: ["id", "at", "actor", "action", "target", "detail"], what: msg("a log of account and review actions (sign-ups, password changes, decisions on proposals and reports), naming the people involved") },
};

/** Outside services a visitor's browser contacts ONLY after the visitor presses a button (nothing is requested while the page is just open), and what that service can then see. */
export const CLICK_TO_LOAD: { host: string; what: string }[] = [
  { host: "www.youtube-nocookie.com", what: msg("YouTube’s video player (Google), when you press play on a video: it can then see your network address, your browser and that you played that video") },
  { host: "platform.twitter.com", what: msg("X’s post embed, when you press the button to show an X post: it can then see your network address, your browser and which post you opened") },
  { host: "embed.reddit.com", what: msg("Reddit’s post embed, when you press the button to show a Reddit post: it can then see your network address, your browser and which post you opened") },
  { host: "www.instagram.com", what: msg("Instagram’s post embed (Meta), when you press the button to show an Instagram post: it can then see your network address, your browser and which post you opened") },
  { host: "www.facebook.com", what: msg("Facebook’s post embed (Meta), when you press the button to show a Facebook post: it can then see your network address, your browser and which post you opened") },
];

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

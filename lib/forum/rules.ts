/**
 * What a forum post may say, and the limits on how often (round 125). Pure functions and numbers, so the rules are one place and a test can hold them.
 * The first release is deliberately strict where abuse is cheapest to do: no links of any kind (the spam this attracts is nearly all links), no long digit
 * strings (phone numbers), no runs of one character, plain text only (no HTML, no markdown). Looser later is easy; tighter after a flood is not.
 */
export const POST_MIN = 2, POST_MAX = 2000, TITLE_MIN = 5, TITLE_MAX = 100;
/** A new account waits this long before its first post: sign-up and spam in one burst is the cheap attack. */
export const NEW_ACCOUNT_WAIT_MS = 5 * 60_000;
/** Accounts under a day old post at most this many times a day. */
export const NEW_ACCOUNT_DAILY = 10, NEW_ACCOUNT_AGE_MS = 24 * 60 * 60_000;
export const POSTS_PER_USER = { max: 10, windowMs: 10 * 60_000 }, POSTS_PER_ADDRESS = { max: 30, windowMs: 10 * 60_000 }, THREADS_PER_USER = { max: 3, windowMs: 24 * 60 * 60_000 };
/** The author may change a post for this long after writing it. */
export const EDIT_WINDOW_MS = 15 * 60_000;
/**
 * Automatic hiding (PLAN 229; it was four reports from day-old accounts, which a handful of sign-ups could meet). A post is hidden until an editor looks when this many
 * DIFFERENT people report it, counting only reporters with real history here: an account at least a week old, with at least a few posts of its own still standing, and
 * not from one network area (see `reportPost`). The number is a setting (FORUM_AUTO_HIDE_REPORTS, 2 or more). The author of a hidden post can ask for a review.
 */
export const AUTO_HIDE_REPORTS = 6;
export const autoHideReports = (): number => { const n = Math.floor(Number(process.env.FORUM_AUTO_HIDE_REPORTS)); return Number.isFinite(n) && n >= 2 ? Math.min(n, 100) : AUTO_HIDE_REPORTS; };
/** Only reports from accounts at least this old, with at least this many visible posts of their own, count toward the automatic hide. (Every report is kept for editors.) */
export const AUTO_HIDE_MIN_AGE_MS = 7 * 24 * 60 * 60_000, REPORTER_MIN_POSTS = 3;
/** An author asks for a review of an automatically hidden post: once per post, and at most this often overall. */
export const APPEALS_PER_USER = { max: 5, windowMs: 24 * 60 * 60_000 };
/**
 * The same post (its letters: not its case, spacing, digits or punctuation) from this many OTHER accounts within the window is a copy-and-paste wave, and is refused.
 * Posts of fewer letters than WAVE_MIN_CHARS are exempt ("Agreed", "Great fight"): many people really do write those.
 */
export const WAVE_OTHERS = 1, WAVE_MIN_CHARS = 24, WAVE_WINDOW_MS = 24 * 60 * 60_000;
/** The words of a post its author withdrew while it was hidden or reported stay readable to editors this long, then are wiped. */
export const WITHDRAWN_KEEP_MS = 90 * 24 * 60 * 60_000;
/** Longest note on a report and longest reason an editor gives, in characters (cut, not refused: they are not posts). */
export const NOTE_MAX = 300, REASON_MAX = 200;
/** Edits of one's own posts: the same ten in ten minutes as writing. */
export const EDITS_PER_USER = { max: 10, windowMs: 10 * 60_000 };
export const PAGE_SIZE = 30, THREADS_PAGE = 20;
export const REPORT_REASONS = ["spam", "abuse", "off_topic", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type PostProblem = "too_short" | "too_long" | "has_link" | "has_number" | "repetitive" | "empty";

/**
 * Invisible and control characters, removed except line breaks and tabs: controls, soft hyphen, the Arabic letter mark, combining grapheme joiner, Hangul and
 * Braille fillers, Mongolian separators, every zero-width, bidi mark, embedding, override and ISOLATE character (U+2066 to U+2069), line and paragraph
 * separators, invisible math operators, variation selectors, the byte order mark and the tag characters.
 */
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u2800\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb\u{e0000}-\u{e0fff}]/gu;
/** More than this many combining marks in a row is a smear ("Zalgo"), not a language: the rest are dropped. Arabic with a shadda and a vowel needs two or three. */
export const MAX_MARKS = 3;
const MARK_RUN = new RegExp(`(\\p{M}{${MAX_MARKS}})\\p{M}+`, "gu");
const LINK = /(?:https?:|ftp:|mailto:|www\.|\b[a-z0-9-]{2,}\.(?:com|net|org|io|me|ly|xyz|ru|cn|top|info|link|click|online|site|shop|co|tv|gg|app)\b|t\.me\/|wa\.me\/)/i;
/** Ten digits or more, however they are spaced: a phone number. (A date, 1998-07-04, is eight, and boxing talk is full of dates.) */
const LONG_NUMBER = /(?:\p{Nd}[\s().-]*){10,}/u; // any script's digits: Arabic-Indic ones are ordinary here
const REPEAT = /(.)\1{11,}/u;

/** The text as it will be stored: invisible characters removed, line endings made \n, trailing spaces gone, at most one blank line in a row, trimmed. */
export function cleanText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.normalize("NFC").replace(INVISIBLE, "").replace(MARK_RUN, "$1").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The text as a link scanner or a reader would take it: full-width and other compatibility forms folded (ｗｗｗ．ｅｘａｍｐｌｅ．ｃｏｍ), ideographic full stops made dots. */
const asTyped = (text: string): string => text.normalize("NFKC").replace(/[\u3002\uff61\u2024\ufe52]/g, ".");

/** The cleaned text and the first thing wrong with it, if anything. */
export function checkText(raw: unknown, opts: { min?: number; max?: number } = {}): { text: string; problem: PostProblem | null } {
  const text = cleanText(raw), min = opts.min ?? POST_MIN, max = opts.max ?? POST_MAX;
  if (!text) return { text, problem: "empty" };
  if ([...text].length < min) return { text, problem: "too_short" };
  if ([...text].length > max) return { text, problem: "too_long" };
  if (LINK.test(asTyped(text))) return { text, problem: "has_link" };
  if (LONG_NUMBER.test(text)) return { text, problem: "has_number" };
  if (REPEAT.test(text)) return { text, problem: "repetitive" };
  return { text, problem: null };
}

/** The text with case, accents, spacing and punctuation taken out: two posts that come to the same words are the same post. (posts.ts keeps only a hash of it.) */
export const normalizedWords = (text: string): string => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** The text as letters only, to notice one post sent from several accounts: normalizedWords with the digits and the spaces taken out as well ("Call 5" and "call 7" are one post). */
export const waveLetters = (text: string): string => normalizedWords(text).replace(/[\p{N}\s]+/gu, "");

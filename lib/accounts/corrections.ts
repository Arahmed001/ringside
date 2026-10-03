import type { DatabaseSync } from "node:sqlite";
import { accountsDb, accountsDbIfAny, audit, nowIso } from "./store";
import { todayIso } from "../clock";
import { countryCode } from "../format";
import { METHODS, hasWinner, isDrawResult } from "../methods";
import { sourceUrlProblem } from "./contributions";
import { isOfficialHost } from "../research/check";
import { hostOf } from "../research/text";
import { officialHostList } from "../research/official-hosts";
import type { User } from "./users";

/**
 * Reports of a wrong fact, and the corrections that come from the ones an editor accepts.
 *
 * A report is a signed-in person saying "this is wrong, and here is the source". Nothing a report says is trusted: it needs a link and the exact
 * words from that page, an editor who is not the reporter reads the source (code can check the quote against the live page) and accepts or rejects it,
 * and only an accepted one changes anything. A report that is about a person ("this is my own record") is never applied: it goes to an admin.
 *
 * An accepted correction is a sourced override of the vendor's value for one field of one fighter or fight. The vendor's feed is rewritten every
 * day, so the override is applied again after every ingest (`applyCorrections`, called by `ingest` before ratings are recomputed, and when the
 * database opens). It records the vendor's own value as it was (`original_value`), so that:
 *  - if the vendor later changes that field to something else again, the correction keeps showing the sourced value but is flagged
 *    `vendor_changed` for an editor to look at (the vendor may have fixed it; the source may now be stale);
 *  - retiring a correction puts the vendor's value back.
 * A correction to a result or method changes ratings, so callers recompute them when `boutsChanged`.
 *
 * WHO MAY CHANGE WHAT. Where a verified owner of a fact exists, the source lies with them; otherwise what we ingest stands.
 *  - A fight's result, method and end round are the commission's or the sanctioning body's to state: a correction can only be accepted if the page it cites is
 *    published by one (a .gov site or a host on data/research/official-hosts.txt). The vendor relays a result, it does not own it.
 *  - A fighter's own details (birth date, height, reach, stance, nickname, country) are theirs to state. An admin links a fighter's account to the profile after
 *    checking who they are (`npm run accounts -- owner`; accounts have no email, so this is done out of band) and that account's corrections apply at once, with
 *    no source needed. For anyone else, a correction to those details is accepted only if the page it cites is one of the fighter's registered official pages.
 *  - A report citing anyone else is not thrown away: an editor marks it `noted` (valid, not from an owner), the ingested value stands, and it stays on record for
 *    someone to chase at the source.
 *
 * Stored in the accounts database, keyed by external ids, so a rebuilt sports database does not lose them.
 */
export type TargetType = "boxer" | "bout";
export const BOXER_FIELDS = ["birth_date", "height_cm", "reach_cm", "stance", "nickname", "country", "other"] as const;
export const BOUT_FIELDS = ["result", "method", "end_round", "other"] as const;
export const FIELDS: Record<TargetType, readonly string[]> = { boxer: BOXER_FIELDS, bout: BOUT_FIELDS };
/** Fields a correction can change. `other` is a report only: an editor looks into it, nothing is applied. */
export const isApplicable = (field: string | null): boolean => !!field && field !== "other";

export interface OwnerLink { userId: number; username: string; boxerExt: string; verifiedBy: string; verifiedAt: string; note: string | null; officialUrls: string[] }
const owners = (acc: DatabaseSync, where: string, ...args: (string | number)[]): OwnerLink[] =>
  (acc.prepare(`SELECT o.user_id, u.username, o.boxer_ext, o.verified_by, o.verified_at, o.note, o.official_urls FROM boxer_owners o JOIN users u ON u.id = o.user_id WHERE ${where} ORDER BY o.verified_at`).all(...args) as Record<string, unknown>[])
    .map((r) => ({ userId: r.user_id as number, username: r.username as string, boxerExt: r.boxer_ext as string, verifiedBy: r.verified_by as string, verifiedAt: r.verified_at as string, note: (r.note as string | null) ?? null, officialUrls: JSON.parse(String(r.official_urls || "[]")) as string[] }));
export const ownersOf = (boxerExt: string, acc: DatabaseSync = accountsDb()): OwnerLink[] => owners(acc, "o.boxer_ext = ?", boxerExt);
export const ownedBy = (userId: number, acc: DatabaseSync = accountsDb()): OwnerLink[] => owners(acc, "o.user_id = ?", userId);
export const isOwner = (userId: number, boxerExt: string, acc: DatabaseSync = accountsDb()): boolean => !!acc.prepare("SELECT 1 x FROM boxer_owners WHERE user_id = ? AND boxer_ext = ?").get(userId, boxerExt);

/**
 * An admin's statement that this account is this fighter (or authorised by them), made after checking out of band. `urls` are the fighter's own official pages: a source
 * from there counts as the owner's for a correction by anyone else.
 */
export function linkOwner(admin: User, username: string, boxer: string, o: { note?: string; urls?: string[] } = {}, main: DatabaseSync, acc: DatabaseSync = accountsDb()): { ok: true; boxerExt: string; boxerName: string } | { ok: false; error: "forbidden" | "user_unknown" | "boxer_unknown" | "url_invalid" } {
  if (admin.role !== "admin") return { ok: false, error: "forbidden" };
  const u = acc.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number } | undefined;
  if (!u) return { ok: false, error: "user_unknown" };
  const b = main.prepare("SELECT external_id e, name FROM boxers WHERE slug = ? OR external_id = ?").get(boxer, boxer) as { e: string; name: string } | undefined;
  if (!b) return { ok: false, error: "boxer_unknown" };
  const urls = (o.urls ?? []).map((x) => String(x).trim()).filter(Boolean);
  if (urls.some(sourceUrlProblem)) return { ok: false, error: "url_invalid" };
  acc.prepare("INSERT INTO boxer_owners (user_id, boxer_ext, verified_by, verified_at, note, official_urls) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id, boxer_ext) DO UPDATE SET verified_by = excluded.verified_by, verified_at = excluded.verified_at, note = excluded.note, official_urls = excluded.official_urls")
    .run(u.id, b.e, admin.username, nowIso(), o.note ? clean(o.note).slice(0, 300) : null, JSON.stringify(urls));
  audit(acc, admin.username, "owner_linked", `${username} -> ${b.e}`, urls.join(" "));
  return { ok: true, boxerExt: b.e, boxerName: b.name };
}
export function unlinkOwner(admin: User, username: string, boxer: string, main: DatabaseSync, acc: DatabaseSync = accountsDb()): boolean {
  if (admin.role !== "admin") return false;
  const b = main.prepare("SELECT external_id e FROM boxers WHERE slug = ? OR external_id = ?").get(boxer, boxer) as { e: string } | undefined;
  const r = b ? acc.prepare("DELETE FROM boxer_owners WHERE boxer_ext = ? AND user_id = (SELECT id FROM users WHERE username = ?)").run(b.e, username).changes : 0;
  if (r) audit(acc, admin.username, "owner_unlinked", `${username} -> ${b!.e}`);
  return r > 0;
}

/** Is `url` the same page as `base` or somewhere under it (a whole path segment, never a longer name that merely starts the same)? */
function underUrl(url: string, base: string): boolean {
  try {
    const u = new URL(url), b = new URL(base);
    if (u.origin !== b.origin) return false;
    const bp = b.pathname.replace(/\/+$/, ""), up = u.pathname.replace(/\/+$/, "");
    return up === bp || up.startsWith(bp + "/");
  } catch { return false; }
}
/**
 * Is the cited page published by the verified owner of this kind of fact? A fight's facts: a commission or sanctioning body (an official host). A fighter's own
 * details: one of that fighter's registered official pages. Anything else is not the owner's word, and the ingested value stands.
 */
export function sourceFromOwner(t: TargetType, ext: string, sourceUrl: string | null, acc: DatabaseSync = accountsDb(), hosts: string[] = officialHostList()): boolean {
  if (!sourceUrl) return false;
  if (t === "bout") return isOfficialHost(hostOf(sourceUrl), hosts);
  return ownersOf(ext, acc).some((o) => o.officialUrls.some((base) => underUrl(sourceUrl, base)));
}

export interface ReportInput {
  kind: "error" | "about_me"; targetType: TargetType; targetExt: string; field?: string;
  /** the value it should be; for a result: red, blue, draw or nc */
  proposed?: string;
  /** a result's method, when it cannot be kept from the current one (a draw corrected to a win) */
  proposedMethod?: string;
  sourceUrl?: string; quote?: string; note?: string; contact?: string;
}
export type ReportError =
  | "kind_invalid" | "target_unknown" | "field_invalid" | "value_invalid" | "no_change" | "bout_not_finished" | "method_needed" | "method_mismatch"
  | "url_invalid" | "quote_short" | "quote_long" | "note_short" | "note_long" | "contact_long" | "duplicate_open" | "too_many_open";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f‎‏‪-‮]/g, " ").replace(/\s+/g, " ").trim();
const validDate = (s: string) => ISO.test(s) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;
const NICK_OK = /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 .'’"\-]{0,39}$/u;
const STANCES = ["Orthodox", "Southpaw", "Switch"];
const MAX_OPEN_PER_USER = 20;

const toStr = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const resultOf = (b: { winner_id: number | null; red_id: number; blue_id: number; method: string | null }): string =>
  b.method === null ? "pending" : b.winner_id === b.red_id ? "red" : b.winner_id === b.blue_id ? "blue" : isDrawResult(b.method) ? "draw" : b.method === "NC" ? "nc" : "unknown";

interface BoutRow { id: number; winner_id: number | null; red_id: number; blue_id: number; method: string | null; end_round: number | null; rounds: number | null; status: string | null }
const getBout = (main: DatabaseSync, ext: string) => main.prepare("SELECT id, winner_id, red_id, blue_id, method, end_round, rounds, status FROM bouts WHERE external_id = ?").get(ext) as BoutRow | undefined;
const getBoxer = (main: DatabaseSync, ext: string) => main.prepare("SELECT id, birth_date, birth_year, height_cm, reach_cm, stance, nickname, country FROM boxers WHERE external_id = ?").get(ext) as Record<string, unknown> | undefined;

/** The value as the site shows it now, as text ("" for none). For a result it is "red|UD": who won, and how. */
export function currentValue(main: DatabaseSync, t: TargetType, ext: string, field: string): string | null {
  if (t === "boxer") {
    const b = getBoxer(main, ext);
    return b ? toStr(b[field]) : null;
  }
  const b = getBout(main, ext);
  if (!b) return null;
  if (field === "result") return `${resultOf(b)}|${b.method ?? ""}`;
  if (field === "method") return toStr(b.method);
  if (field === "end_round") return toStr(b.end_round);
  return null;
}

/** Puts a value in the sports database. Returns whether a bout changed (so ratings must be recomputed). */
function write(main: DatabaseSync, t: TargetType, ext: string, field: string, value: string): boolean {
  if (t === "boxer") {
    const id = (getBoxer(main, ext) as { id: number }).id;
    if (field === "birth_date") main.prepare("UPDATE boxers SET birth_date = ?, birth_year = ? WHERE id = ?").run(value || null, value ? Number(value.slice(0, 4)) : null, id);
    else if (field === "height_cm" || field === "reach_cm") main.prepare(`UPDATE boxers SET ${field} = ? WHERE id = ?`).run(value === "" ? null : Number(value), id);
    else main.prepare(`UPDATE boxers SET ${field} = ? WHERE id = ?`).run(value === "" ? null : value, id); // stance, nickname, country
    return false;
  }
  const b = getBout(main, ext) as BoutRow;
  if (field === "result") {
    const [res, method] = value.split("|");
    const winner = res === "red" ? b.red_id : res === "blue" ? b.blue_id : null;
    main.prepare("UPDATE bouts SET winner_id = ?, method = ? WHERE id = ?").run(winner, method || null, b.id);
  } else if (field === "method") main.prepare("UPDATE bouts SET method = ? WHERE id = ?").run(value || null, b.id);
  else if (field === "end_round") main.prepare("UPDATE bouts SET end_round = ? WHERE id = ?").run(value === "" ? null : Number(value), b.id);
  return true;
}

export interface NormalizedReport {
  kind: "error" | "about_me"; targetType: TargetType; targetExt: string; field: string | null; shown: string | null; proposed: string | null;
  sourceUrl: string | null; quote: string | null; note: string | null; contact: string | null;
}

export function validateReport(p: ReportInput, main: DatabaseSync, today = todayIso(), asOwner = false): { ok: true; value: NormalizedReport } | { ok: false; error: ReportError } {
  const err = (error: ReportError) => ({ ok: false as const, error });
  if (!p || (p.kind !== "error" && p.kind !== "about_me")) return err("kind_invalid");
  if (p.targetType !== "boxer" && p.targetType !== "bout") return err("target_unknown");
  if (typeof p.targetExt !== "string" || !(p.targetType === "boxer" ? getBoxer(main, p.targetExt) : getBout(main, p.targetExt))) return err("target_unknown");
  const note = p.note ? clean(String(p.note)) : "";
  const base = { kind: p.kind, targetType: p.targetType, targetExt: p.targetExt, field: null, shown: null, proposed: null, sourceUrl: null, quote: null } as const;

  if (p.kind === "about_me") { // a person asking about their own details: never applied, goes to an admin
    if (p.targetType !== "boxer") return err("target_unknown");
    if (note.length < 20) return err("note_short");
    if (note.length > 1500) return err("note_long");
    const contact = p.contact ? clean(String(p.contact)) : "";
    if (contact.length > 200) return err("contact_long");
    return { ok: true, value: { ...base, note, contact: contact || null } };
  }

  const field = String(p.field ?? "");
  if (!FIELDS[p.targetType].includes(field)) return err("field_invalid");
  if (note.length > 1500) return err("note_long");
  const url = p.sourceUrl ? String(p.sourceUrl).trim() : "";
  const quote = p.quote ? clean(String(p.quote)) : "";
  const withSource = () => {
    if (asOwner && !url && !quote) return null; // the fighter's own word is the source
    if (!url || sourceUrlProblem(url)) return err("url_invalid");
    if (quote.length < 12) return err("quote_short");
    if (quote.length > 300) return err("quote_long");
    return null;
  };

  if (field === "other") { // a report only: something an editor should look into
    if (note.length < 20) return err("note_short");
    if (url && sourceUrlProblem(url)) return err("url_invalid");
    return { ok: true, value: { ...base, field, note, contact: null, sourceUrl: url || null, quote: quote || null } };
  }

  const bad = withSource();
  if (bad) return bad;
  const shown = currentValue(main, p.targetType, p.targetExt, field);
  const raw = clean(String(p.proposed ?? ""));
  let proposed = raw;

  if (p.targetType === "boxer") {
    if (field === "birth_date") {
      const youngest = new Date(Date.parse(today + "T12:00:00Z")); youngest.setUTCFullYear(youngest.getUTCFullYear() - 14);
      if (!validDate(raw) || raw < "1900-01-01" || raw > youngest.toISOString().slice(0, 10)) return err("value_invalid");
    } else if (field === "height_cm") { if (!/^\d{3}$/.test(raw) || +raw < 120 || +raw > 240) return err("value_invalid"); }
    else if (field === "reach_cm") { if (!/^\d{3}$/.test(raw) || +raw < 120 || +raw > 260) return err("value_invalid"); }
    else if (field === "stance") { const m = STANCES.find((s) => s.toLowerCase() === raw.toLowerCase()); if (!m) return err("value_invalid"); proposed = m; }
    else if (field === "nickname") { if (!NICK_OK.test(raw)) return err("value_invalid"); }
    else if (field === "country") {
      const code = countryCode(raw);
      if (!code) return err("value_invalid");
      try { proposed = new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? raw; } catch { proposed = raw; }
    }
  } else {
    const b = getBout(main, p.targetExt) as BoutRow;
    if (b.method === null || b.status === "cancelled") return err("bout_not_finished");
    const res = resultOf(b);
    if (field === "result") {
      const r = raw.toLowerCase();
      if (!["red", "blue", "draw", "nc"].includes(r)) return err("value_invalid");
      const asked = p.proposedMethod ? clean(String(p.proposedMethod)).toUpperCase() : "";
      if (asked && !(METHODS as readonly string[]).includes(asked)) return err("value_invalid");
      let method: string;
      if (r === "red" || r === "blue") {
        method = asked || (hasWinner(b.method) ? b.method : "");
        if (!method) return err("method_needed"); // a draw or no contest corrected to a win: how did it end?
        if (!hasWinner(method)) return err("method_mismatch");
      } else if (r === "draw") {
        method = asked || (isDrawResult(b.method) ? b.method : "DRAW");
        if (!isDrawResult(method)) return err("method_mismatch");
      } else {
        method = "NC";
        if (asked && asked !== "NC") return err("method_mismatch");
      }
      proposed = `${r}|${method}`;
      if (proposed === `${res}|${b.method}`) return err("no_change");
    } else if (field === "method") {
      const m = raw.toUpperCase();
      if (!(METHODS as readonly string[]).includes(m)) return err("value_invalid");
      // the method has to agree with who won: a winner needs a result that names one, a draw a draw, a no contest NC
      if ((res === "red" || res === "blue") && !hasWinner(m)) return err("method_mismatch");
      if (res === "draw" && !isDrawResult(m)) return err("method_mismatch");
      if (res === "nc" && m !== "NC") return err("method_mismatch");
      proposed = m;
    } else if (field === "end_round") {
      if (!/^\d{1,2}$/.test(raw) || +raw < 1 || +raw > Math.max(b.rounds ?? 12, 1)) return err("value_invalid");
      proposed = String(Number(raw));
    }
  }
  if (proposed === (shown ?? "")) return err("no_change");
  return { ok: true, value: { ...base, field, shown, proposed, sourceUrl: url || null, quote: quote || null, note: note || null, contact: null } };
}

/**
 * One correction at a time for a field: the earlier one is retired and the vendor's value it recorded is put back, so the new correction starts from the
 * vendor's value (not from the earlier correction's own write, which it would take for a change by the vendor) and inherits that value as its original.
 * Runs inside the caller's transaction on the accounts database. Returns whether a fight was changed by putting a value back.
 */
function supersede(acc: DatabaseSync, main: DatabaseSync, newId: number, t: TargetType, ext: string, field: string, actor: string): boolean {
  let restoredBout = false;
  const prev = acc.prepare("SELECT id, original_value, proposed_value FROM reports WHERE status = 'accepted' AND state IN ('active','vendor_changed') AND target_type = ? AND target_ext = ? AND field = ? AND id != ?").all(t, ext, field, newId) as { id: number; original_value: string | null; proposed_value: string }[];
  for (const p of prev) {
    acc.prepare("UPDATE reports SET state = 'retired' WHERE id = ?").run(p.id);
    if (p.original_value !== null) {
      acc.prepare("UPDATE reports SET original_value = ? WHERE id = ? AND original_value IS NULL").run(p.original_value, newId);
      if (currentValue(main, t, ext, field) === p.proposed_value && write(main, t, ext, field, p.original_value) && t === "bout") restoredBout = true;
    }
    audit(acc, actor, "correction_superseded", `#${p.id}`, `by #${newId}`);
  }
  return restoredBout;
}

export type SubmitResult = { ok: true; id: number; /** set when the fighter's own correction was applied at once */ applied?: ApplyResult } | { ok: false; error: ReportError };
export function submitReport(user: User, p: ReportInput, main: DatabaseSync, acc: DatabaseSync = accountsDb(), today = todayIso()): SubmitResult {
  // the fighter's own word about their own details is the source: applied at once, with no source and no second person, and recorded as the owner's
  const asOwner = p?.kind === "error" && p.targetType === "boxer" && isApplicable(p.field ?? null) && typeof p.targetExt === "string" && isOwner(user.id, p.targetExt, acc);
  const v = validateReport(p, main, today, asOwner);
  if (!v.ok) return v;
  const x = v.value;
  if (asOwner) {
    acc.exec("BEGIN");
    let id: number;
    try {
      id = (acc.prepare(`INSERT INTO reports (user_id, kind, target_type, target_ext, field, shown_value, proposed_value, source_url, quote, note, created_at, status, reviewed_at, review_note, state, by_owner) VALUES (?,?,?,?,?,?,?,?,?,?,?, 'accepted', ?, 'Provided by the fighter (verified owner of these details).', 'active', 1) RETURNING id`)
        .get(user.id, x.kind, x.targetType, x.targetExt, x.field, x.shown, x.proposed, x.sourceUrl, x.quote, x.note, nowIso(), nowIso()) as { id: number }).id;
      const restoredBout = supersede(acc, main, id, x.targetType, x.targetExt, x.field as string, user.username);
      audit(acc, user.username, "owner_correction", `#${id}`, `${x.targetExt} ${x.field} -> ${x.proposed}`);
      acc.exec("COMMIT");
      const applied = applyCorrections(main, acc);
      if (restoredBout) applied.boutsChanged = true;
      return { ok: true, id, applied };
    } catch (e) { acc.exec("ROLLBACK"); throw e; }
  }
  const open = (acc.prepare("SELECT COUNT(*) c FROM reports WHERE user_id = ? AND status = 'open'").get(user.id) as { c: number }).c;
  if (open >= MAX_OPEN_PER_USER) return { ok: false, error: "too_many_open" };
  const dup = x.kind === "about_me"
    ? acc.prepare("SELECT 1 y FROM reports WHERE status = 'open' AND kind = 'about_me' AND user_id = ? AND target_ext = ?").get(user.id, x.targetExt)
    : acc.prepare("SELECT 1 y FROM reports WHERE status = 'open' AND kind = 'error' AND target_type = ? AND target_ext = ? AND field = ? AND COALESCE(proposed_value, '') = ?").get(x.targetType, x.targetExt, x.field, x.proposed ?? "");
  if (dup) return { ok: false, error: "duplicate_open" };
  const r = acc.prepare(`INSERT INTO reports (user_id, kind, target_type, target_ext, field, shown_value, proposed_value, source_url, quote, note, contact, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`)
    .get(user.id, x.kind, x.targetType, x.targetExt, x.field, x.shown, x.proposed, x.sourceUrl, x.quote, x.note, x.contact, nowIso()) as { id: number };
  return { ok: true, id: r.id };
}

export interface ReportView {
  id: number; kind: "error" | "about_me"; status: string; state: string | null; targetType: TargetType; targetExt: string; targetName: string | null; targetSlug: string | null;
  field: string | null; shown: string | null; proposed: string | null; current: string | null; sourceUrl: string | null; quote: string | null; note: string | null; contact: string | null;
  createdAt: string; reporter: string | null; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null; sourceCheck: string | null; sourceCheckedAt: string | null;
  originalValue: string | null; vendorValue: string | null;
  /** a correction the fighter made about themself (applied at once) */
  byOwner: boolean;
  /** for a correction not yet decided: is the cited page published by the verified owner of this kind of fact? (null for a report that is not a correction) */
  sourceFromOwner: boolean | null;
}
const SELECT = `SELECT r.*, u.username reporter, v.username reviewer FROM reports r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN users v ON v.id = r.reviewed_by`;
function view(r: Record<string, unknown>, main: DatabaseSync, forReviewer: boolean, acc: DatabaseSync, hosts: string[]): ReportView {
  const t = r.target_type as TargetType, ext = r.target_ext as string;
  let name: string | null = null, slug: string | null = null;
  if (t === "boxer") { const b = main.prepare("SELECT name, slug FROM boxers WHERE external_id = ?").get(ext) as { name: string; slug: string } | undefined; name = b?.name ?? null; slug = b?.slug ?? null; }
  else {
    const b = main.prepare("SELECT r.name rn, u.name un FROM bouts x JOIN boxers r ON r.id = x.red_id JOIN boxers u ON u.id = x.blue_id WHERE x.external_id = ?").get(ext) as { rn: string; un: string } | undefined;
    name = b ? `${b.rn} vs ${b.un}` : null; slug = ext;
  }
  const field = (r.field as string | null) ?? null;
  return {
    id: r.id as number, kind: r.kind as "error" | "about_me", status: r.status as string, state: (r.state as string | null) ?? null, targetType: t, targetExt: ext, targetName: name, targetSlug: slug,
    field, shown: (r.shown_value as string | null) ?? null, proposed: (r.proposed_value as string | null) ?? null, current: field && field !== "other" ? currentValue(main, t, ext, field) : null,
    sourceUrl: (r.source_url as string | null) ?? null, quote: (r.quote as string | null) ?? null, note: (r.note as string | null) ?? null,
    // contact details are for the admin who handles an about-me request, never for the person's own list or for editors
    contact: forReviewer ? ((r.contact as string | null) ?? null) : null,
    createdAt: r.created_at as string, reporter: (r.reporter as string | null) ?? null, reviewedBy: (r.reviewer as string | null) ?? null, reviewedAt: (r.reviewed_at as string | null) ?? null,
    reviewNote: (r.review_note as string | null) ?? null, sourceCheck: forReviewer ? ((r.source_check as string | null) ?? null) : null, sourceCheckedAt: forReviewer ? ((r.source_checked_at as string | null) ?? null) : null,
    originalValue: forReviewer ? ((r.original_value as string | null) ?? null) : null, vendorValue: forReviewer ? ((r.vendor_value as string | null) ?? null) : null,
    byOwner: r.by_owner === 1,
    sourceFromOwner: forReviewer && r.kind === "error" && isApplicable(field) ? sourceFromOwner(t, ext, (r.source_url as string | null) ?? null, acc, hosts) : null,
  };
}

/** A person's own reports (without a reviewer's source check or anyone's contact details). */
export const myReports = (userId: number, main: DatabaseSync, acc: DatabaseSync = accountsDb()): ReportView[] =>
  (acc.prepare(`${SELECT} WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 200`).all(userId) as Record<string, unknown>[]).map((r) => view(r, main, false, acc, []));

export type QueueKind = "error" | "about_me" | "flagged" | "owner";
/**
 * The queue for a reviewer. Editors see error reports; only admins see about-me requests (they can raise privacy questions and carry contact details).
 * `flagged` is the accepted corrections whose vendor value has changed again since they were made; `owner` is what fighters changed about themselves (applied at once,
 * so this is the after-the-fact look). Each open correction says whether its source is published by a verified owner (`sourceFromOwner`).
 */
export function reportQueue(viewer: User, main: DatabaseSync, o: { status?: string; kind?: QueueKind; hosts?: string[] } = {}, acc: DatabaseSync = accountsDb()): ReportView[] {
  if (viewer.role !== "editor" && viewer.role !== "admin") return [];
  const kind: QueueKind = (["error", "about_me", "flagged", "owner"] as const).find((k) => k === o.kind) ?? "error"; // whitelisted: it is part of the query below
  if (kind === "about_me" && viewer.role !== "admin") return [];
  const status = ["open", "accepted", "rejected", "withdrawn", "noted"].includes(o.status ?? "") ? o.status! : "open";
  const hosts = o.hosts ?? officialHostList();
  const where = kind === "flagged" ? "r.status = 'accepted' AND r.state = 'vendor_changed'" : kind === "owner" ? "r.status = 'accepted' AND r.by_owner = 1" : `r.status = '${status}' AND r.kind = '${kind}'`;
  return (acc.prepare(`${SELECT} WHERE ${where} ORDER BY r.id ${(status === "open" && kind !== "owner") || kind === "flagged" ? "ASC" : "DESC"} LIMIT 200`).all() as Record<string, unknown>[]).map((r) => view(r, main, true, acc, hosts));
}

export const withdrawReport = (user: User, id: number, acc: DatabaseSync = accountsDb()): boolean =>
  acc.prepare("UPDATE reports SET status = 'withdrawn' WHERE id = ? AND user_id = ? AND status = 'open'").run(id, user.id).changes > 0;

export interface ApplyResult { applied: number; unchanged: number; vendorChanged: number; skipped: number; boutsChanged: boolean }
const none = (): ApplyResult => ({ applied: 0, unchanged: 0, vendorChanged: 0, skipped: 0, boutsChanged: false });

export type ReviewError = "not_found" | "not_open" | "own" | "note_required" | "forbidden" | "not_a_correction" | "source_not_owner";
export function reviewReport(reviewer: User, id: number, decision: "accepted" | "rejected" | "noted", note: string, main: DatabaseSync, acc: DatabaseSync = accountsDb(), hosts: string[] = officialHostList()): { ok: true; applied: ApplyResult } | { ok: false; error: ReviewError } {
  const c = acc.prepare("SELECT * FROM reports WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!c) return { ok: false, error: "not_found" };
  const aboutMe = c.kind === "about_me";
  if (reviewer.role !== "admin" && (reviewer.role !== "editor" || aboutMe)) return { ok: false, error: "forbidden" };
  if (c.status !== "open") return { ok: false, error: "not_open" };
  if (c.user_id === reviewer.id && reviewer.role !== "admin") return { ok: false, error: "own" };
  if (decision === "noted" && aboutMe) return { ok: false, error: "not_a_correction" }; // an about-me request is accepted (handled) or rejected, never "noted"
  const n = clean(note).slice(0, 500);
  if ((decision === "rejected" || decision === "noted" || aboutMe) && n.length < 5) return { ok: false, error: "note_required" };
  const apply = decision === "accepted" && !aboutMe && isApplicable(c.field as string | null);
  // where a verified owner of the fact exists the source lies with them; a correction citing anyone else cannot change what the vendor said
  if (apply && !sourceFromOwner(c.target_type as TargetType, c.target_ext as string, (c.source_url as string | null) ?? null, acc, hosts)) return { ok: false, error: "source_not_owner" };
  let restoredBout = false;
  acc.exec("BEGIN");
  try {
    acc.prepare("UPDATE reports SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, state = ? WHERE id = ?").run(decision, reviewer.id, nowIso(), n || null, apply ? "active" : null, id);
    if (apply) restoredBout = supersede(acc, main, id, c.target_type as TargetType, c.target_ext as string, c.field as string, reviewer.username);
    audit(acc, reviewer.username, `report_${decision}`, `#${id}`, `${c.target_type} ${c.target_ext} ${c.field ?? c.kind}`);
    acc.exec("COMMIT");
  } catch (e) { acc.exec("ROLLBACK"); throw e; }
  if (!apply) return { ok: true, applied: none() };
  const applied = applyCorrections(main, acc);
  if (restoredBout) applied.boutsChanged = true;
  return { ok: true, applied };
}

/**
 * Settles a correction the vendor has changed under: `keep` (the sourced value stands; the vendor's new value becomes the one to compare against from now on) or
 * `retire` (stop correcting; the vendor's own value is put back).
 */
export function settleFlagged(reviewer: User, id: number, action: "keep" | "retire", note: string, main: DatabaseSync, acc: DatabaseSync = accountsDb()): { ok: true; applied: ApplyResult } | { ok: false; error: ReviewError } {
  if (reviewer.role !== "editor" && reviewer.role !== "admin") return { ok: false, error: "forbidden" };
  const c = acc.prepare("SELECT * FROM reports WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!c) return { ok: false, error: "not_found" };
  if (c.status !== "accepted" || (c.state !== "vendor_changed" && c.state !== "active") || !isApplicable(c.field as string | null)) return { ok: false, error: "not_a_correction" };
  const n = clean(note).slice(0, 500);
  if (n.length < 5) return { ok: false, error: "note_required" };
  const t = c.target_type as TargetType, ext = c.target_ext as string, field = c.field as string;
  let boutsChanged = false;
  if (action === "keep") acc.prepare("UPDATE reports SET state = 'active', original_value = COALESCE(vendor_value, original_value), vendor_value = NULL WHERE id = ?").run(id);
  else {
    // put the vendor's value back, but only if what is there now is still ours
    const cur = currentValue(main, t, ext, field);
    if (c.original_value !== null && cur === c.proposed_value) boutsChanged = write(main, t, ext, field, c.original_value as string);
    acc.prepare("UPDATE reports SET state = 'retired' WHERE id = ?").run(id);
  }
  audit(acc, reviewer.username, `correction_${action}`, `#${id}`, n);
  return { ok: true, applied: { ...none(), boutsChanged } };
}

/**
 * Makes the sports database carry every active correction. Idempotent, and safe to run after every ingest and whenever the database opens.
 * For each accepted correction: take the vendor's value as it is now; the first time, remember it (`original_value`); if it is not already the corrected
 * value, write the corrected one. If the vendor's value is neither what it was when the correction was made nor the corrected value, the vendor has
 * changed it since: the corrected value still goes in (it rests on a source an editor read) but the correction is flagged `vendor_changed` for review.
 */
export function applyCorrections(main: DatabaseSync, acc: DatabaseSync | null = accountsDbIfAny()): ApplyResult {
  const out = none();
  if (!acc) return out;
  const rows = acc.prepare("SELECT * FROM reports WHERE status = 'accepted' AND state IN ('active','vendor_changed') AND field IS NOT NULL AND field != 'other' ORDER BY id").all() as Record<string, unknown>[];
  for (const r of rows) {
    const t = r.target_type as TargetType, ext = r.target_ext as string, field = r.field as string, proposed = r.proposed_value as string;
    const cur = currentValue(main, t, ext, field);
    if (cur === null) { out.skipped++; continue; } // the fighter or fight is not in this database
    const original = (r.original_value as string | null) ?? null;
    if (original === null) { // first time: remember what the vendor said, then correct it
      acc.prepare("UPDATE reports SET original_value = ?, applied_at = ? WHERE id = ?").run(cur, nowIso(), r.id as number);
      if (cur === proposed) { out.unchanged++; continue; }
      if (write(main, t, ext, field, proposed)) out.boutsChanged = true;
      out.applied++;
      continue;
    }
    if (cur === proposed) { out.unchanged++; if (field === "birth_date" && t === "boxer") write(main, t, ext, field, proposed); continue; } // our value is in; keep the year in step with the date
    if (cur === original) { // the vendor rewrote its old value: correct it again
      if (write(main, t, ext, field, proposed)) out.boutsChanged = true;
      out.applied++;
      if (r.state === "vendor_changed") acc.prepare("UPDATE reports SET state = 'active', vendor_value = NULL WHERE id = ?").run(r.id as number);
      continue;
    }
    // the vendor now says something else: ours stays in, and an editor is asked to look
    if (write(main, t, ext, field, proposed)) out.boutsChanged = true;
    out.vendorChanged++;
    acc.prepare("UPDATE reports SET state = 'vendor_changed', vendor_value = ? WHERE id = ?").run(cur, r.id as number);
  }
  return out;
}

/** An active correction, for the "corrected from a source" / "provided by the fighter" note on a page. */
export interface CorrectionNote { id: number; targetType: TargetType; targetExt: string; field: string; value: string; sourceUrl: string | null; byOwner: boolean; appliedAt: string | null }
const noteRows = (acc: DatabaseSync): Record<string, string | number | null>[] =>
  acc.prepare("SELECT id, target_type, target_ext, field, proposed_value, source_url, by_owner, applied_at FROM reports WHERE status = 'accepted' AND state IN ('active','vendor_changed') AND field != 'other' ORDER BY id").all() as Record<string, string | number | null>[];
const toNote = (r: Record<string, string | number | null>): CorrectionNote => ({ id: Number(r.id), targetType: r.target_type as TargetType, targetExt: r.target_ext as string, field: r.field as string, value: r.proposed_value as string, sourceUrl: (r.source_url as string | null) ?? null, byOwner: r.by_owner === 1, appliedAt: (r.applied_at as string | null) ?? null });

/** Active corrections for a fighter and for the fights they were in. */
export function correctionsFor(boxerExt: string, boutExts: string[], acc: DatabaseSync | null = accountsDbIfAny()): CorrectionNote[] {
  if (!acc) return [];
  const bouts = new Set(boutExts);
  return noteRows(acc).filter((r) => (r.target_type === "boxer" ? r.target_ext === boxerExt : bouts.has(r.target_ext as string))).map(toNote);
}

/** What a fighter's page says about corrections: the fighter's own details, then the fights they were in (by the fight's database id). */
export function boxerPageNotes(main: DatabaseSync, boxerId: number, acc: DatabaseSync | null = accountsDbIfAny()): { boxer: CorrectionNote[]; bouts: (CorrectionNote & { boutId: number })[] } {
  if (!acc) return { boxer: [], bouts: [] };
  const rows = noteRows(acc);
  if (!rows.length) return { boxer: [], bouts: [] };
  const ext = (main.prepare("SELECT external_id e FROM boxers WHERE id = ?").get(boxerId) as { e: string } | undefined)?.e;
  const mine = new Map((main.prepare("SELECT id, external_id e FROM bouts WHERE red_id = ? OR blue_id = ?").all(boxerId, boxerId) as { id: number; e: string }[]).map((b) => [b.e, b.id]));
  return {
    boxer: rows.filter((r) => r.target_type === "boxer" && r.target_ext === ext).map(toNote),
    bouts: rows.filter((r) => r.target_type === "bout" && mine.has(r.target_ext as string)).map((r) => ({ ...toNote(r), boutId: mine.get(r.target_ext as string)! })),
  };
}
/** The same for one fight page, by the fight's database id. */
export function boutPageNotes(main: DatabaseSync, boutId: number, acc: DatabaseSync | null = accountsDbIfAny()): CorrectionNote[] {
  if (!acc) return [];
  const ext = (main.prepare("SELECT external_id e FROM bouts WHERE id = ?").get(boutId) as { e: string } | undefined)?.e;
  return ext ? noteRows(acc).filter((r) => r.target_type === "bout" && r.target_ext === ext).map(toNote) : [];
}

/** The fighters an account is the verified owner of (the report form tells them their own corrections apply at once). */
export function myOwned(userId: number, main: DatabaseSync, acc: DatabaseSync = accountsDb()): { slug: string; name: string }[] {
  return ownedBy(userId, acc).flatMap((o) => { const b = main.prepare("SELECT slug, name FROM boxers WHERE external_id = ?").get(o.boxerExt) as { slug: string; name: string } | undefined; return b ? [{ slug: b.slug, name: b.name }] : []; });
}

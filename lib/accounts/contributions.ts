import type { DatabaseSync } from "node:sqlite";
import { accountsDb, accountsDbIfAny, audit, nowIso } from "./store";
import { slugify } from "../slug";
import { todayIso } from "../clock";
import type { User } from "./users";

/**
 * Community edits to a fighter's team history (who trained or managed them, and when). Anyone signed in can propose one; an editor reads
 * the source and approves or rejects it; only an approved edit reaches the database, as a team-history row whose source is "Community
 * edit" and which carries the link and the quote it rests on. Nothing is trusted on the proposer's word: the quote and link are required,
 * reviewers can have the quote checked against the live page by code, and the reviewer cannot be the proposer (admins excepted).
 * Approved edits live here, in the accounts database, and are replayed into the sports database whenever it opens or is rebuilt.
 */
import { EDIT_SOURCE } from "./edit-source";
export { EDIT_SOURCE };
export const ROLES = ["head_trainer", "assistant_trainer", "strength_coach", "cutman", "manager"] as const;
export type EditRole = (typeof ROLES)[number];

export interface Proposal { boxerExt: string; role: string; personName: string; start: string; end?: string | null; sourceUrl: string; quote: string; note?: string }
export type ProposalError = "boxer_unknown" | "role_invalid" | "person_invalid" | "start_invalid" | "end_invalid" | "dates_order" | "future" | "url_invalid" | "quote_short" | "quote_long" | "note_long" | "duplicate_pending" | "already_known";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: unknown): s is string => typeof s === "string" && ISO.test(s) && !Number.isNaN(Date.parse(s + "T12:00:00Z")) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s && s >= "1900-01-01";
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f‎‏‪-‮]/g, " ").replace(/\s+/g, " ").trim();
/** Person names: letters (any script), spaces and . ' - only, 2 to 80 characters, never a link. */
export const NAME_OK = /^[\p{L}\p{M}][\p{L}\p{M}.'’\- ]{1,79}$/u;

export function sourceUrlProblem(u: string): boolean {
  if (u.length > 500) return true;
  let url: URL;
  try { url = new URL(u); } catch { return true; }
  return !/^https?:$/.test(url.protocol) || !!url.username || !!url.password || !url.hostname.includes(".");
}

export function validateProposal(p: Proposal, main: DatabaseSync, today = todayIso()): { ok: true; value: Required<Omit<Proposal, "note">> & { note: string | null } } | { ok: false; error: ProposalError } {
  const err = (error: ProposalError) => ({ ok: false as const, error });
  if (!p || typeof p.boxerExt !== "string" || !main.prepare("SELECT 1 x FROM boxers WHERE external_id = ?").get(p.boxerExt)) return err("boxer_unknown");
  if (!(ROLES as readonly string[]).includes(p.role)) return err("role_invalid");
  const person = clean(String(p.personName ?? ""));
  if (!NAME_OK.test(person)) return err("person_invalid");
  if (!validDate(p.start)) return err("start_invalid");
  const end = p.end ? p.end : null;
  if (end !== null && !validDate(end)) return err("end_invalid");
  if (end !== null && end < p.start) return err("dates_order");
  if (p.start > today || (end !== null && end > today)) return err("future");
  if (typeof p.sourceUrl !== "string" || sourceUrlProblem(p.sourceUrl.trim())) return err("url_invalid");
  const quote = clean(String(p.quote ?? ""));
  if (quote.length < 12) return err("quote_short");
  if (quote.length > 300) return err("quote_long");
  const note = p.note ? clean(String(p.note)) : "";
  if (note.length > 500) return err("note_long");
  return { ok: true, value: { boxerExt: p.boxerExt, role: p.role, personName: person, start: p.start, end, sourceUrl: p.sourceUrl.trim(), quote, note: note || null } as never };
}

export function submit(user: User, p: Proposal, main: DatabaseSync, acc: DatabaseSync = accountsDb(), today = todayIso()): { ok: true; id: number } | { ok: false; error: ProposalError } {
  const v = validateProposal(p, main, today);
  if (!v.ok) return v;
  const x = v.value;
  const dup = acc.prepare("SELECT 1 y FROM contributions WHERE status IN ('pending','approved') AND boxer_ext = ? AND role = ? AND lower(person_name) = lower(?) AND start_date = ?").get(x.boxerExt, x.role, x.personName, x.start);
  if (dup) return { ok: false, error: "duplicate_pending" };
  const known = main.prepare(`SELECT 1 y FROM team_stints s JOIN boxers b ON b.id = s.boxer_id JOIN people p ON p.id = s.person_id WHERE b.external_id = ? AND s.role = ? AND lower(p.name) = lower(?) AND s.start_date = ? AND s.source != ?`).get(x.boxerExt, x.role, x.personName, x.start, EDIT_SOURCE);
  if (known) return { ok: false, error: "already_known" };
  const r = acc.prepare(`INSERT INTO contributions (user_id, boxer_ext, role, person_name, start_date, end_date, source_url, quote, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id`)
    .get(user.id, x.boxerExt, x.role, x.personName, x.start, x.end, x.sourceUrl, x.quote, x.note, nowIso()) as { id: number };
  return { ok: true, id: r.id };
}

export interface ContributionView {
  id: number; status: string; boxerExt: string; boxerName: string | null; boxerSlug: string | null; role: string; personName: string; start: string; end: string | null;
  sourceUrl: string; quote: string; note: string | null; createdAt: string; proposer: string | null; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null;
  sourceCheck: string | null; sourceCheckedAt: string | null; flags: string[];
}

/** Reasons a reviewer should look twice (never reasons to refuse by themselves). Codes, translated by the page. */
export function flagsFor(c: { boxerExt: string; role: string; personName: string; start: string; end: string | null; quote: string }, main: DatabaseSync): string[] {
  const out: string[] = [];
  const surname = c.personName.split(" ").filter(Boolean).slice(-1)[0]?.toLowerCase().replace(/[.']/g, "") ?? "";
  if (surname.length >= 3 && !c.quote.toLowerCase().replace(/[.']/g, "").includes(surname)) out.push("quote_lacks_name");
  const box = main.prepare("SELECT id FROM boxers WHERE external_id = ?").get(c.boxerExt) as { id: number } | undefined;
  if (box) {
    const same = main.prepare(`SELECT p.name, s.start_date, s.end_date FROM team_stints s LEFT JOIN people p ON p.id = s.person_id WHERE s.boxer_id = ? AND s.role = ? AND s.person_id IS NOT NULL`).all(box.id, c.role) as { name: string; start_date: string | null; end_date: string | null }[];
    const end = c.end ?? "9999-12-31";
    if (c.role === "head_trainer" || c.role === "manager") {
      const clash = same.find((s) => s.name?.toLowerCase() !== c.personName.toLowerCase() && (s.start_date ?? "0000") <= end && (s.end_date ?? "9999-12-31") >= c.start);
      if (clash) out.push("overlaps_other");
    }
    const first = main.prepare("SELECT MIN(e.date) d FROM bouts b JOIN events e ON e.id = b.event_id WHERE b.red_id = ? OR b.blue_id = ?").get(box.id, box.id) as { d: string | null };
    if (first.d && c.start < `${Number(first.d.slice(0, 4)) - 6}-01-01`) out.push("before_career");
  }
  if (!main.prepare("SELECT 1 x FROM people WHERE lower(name) = lower(?)").get(c.personName)) out.push("new_person");
  return out;
}

const view = (r: Record<string, unknown>, main: DatabaseSync): ContributionView => {
  const box = main.prepare("SELECT name, slug FROM boxers WHERE external_id = ?").get(r.boxer_ext as string) as { name: string; slug: string } | undefined;
  const c = { boxerExt: r.boxer_ext as string, role: r.role as string, personName: r.person_name as string, start: r.start_date as string, end: (r.end_date as string) ?? null, quote: r.quote as string };
  return { id: r.id as number, status: r.status as string, ...c, boxerName: box?.name ?? null, boxerSlug: box?.slug ?? null, sourceUrl: r.source_url as string, note: (r.note as string) ?? null,
    createdAt: r.created_at as string, proposer: (r.proposer as string) ?? null, reviewedBy: (r.reviewer as string) ?? null, reviewedAt: (r.reviewed_at as string) ?? null, reviewNote: (r.review_note as string) ?? null,
    sourceCheck: (r.source_check as string) ?? null, sourceCheckedAt: (r.source_checked_at as string) ?? null, flags: r.status === "pending" ? flagsFor(c, main) : [] };
};
const SELECT = `SELECT c.*, u.username proposer, v.username reviewer FROM contributions c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users v ON v.id = c.reviewed_by`;

export const mine = (userId: number, main: DatabaseSync, acc: DatabaseSync = accountsDb()): ContributionView[] =>
  (acc.prepare(`${SELECT} WHERE c.user_id = ? ORDER BY c.id DESC LIMIT 200`).all(userId) as Record<string, unknown>[]).map((r) => view(r, main));

export const queue = (main: DatabaseSync, status = "pending", acc: DatabaseSync = accountsDb()): ContributionView[] =>
  (acc.prepare(`${SELECT} WHERE c.status = ? ORDER BY c.id ${status === "pending" ? "ASC" : "DESC"} LIMIT 200`).all(status) as Record<string, unknown>[]).map((r) => view(r, main));

export function withdraw(user: User, id: number, acc: DatabaseSync = accountsDb()): boolean {
  return acc.prepare("UPDATE contributions SET status = 'withdrawn' WHERE id = ? AND user_id = ? AND status = 'pending'").run(id, user.id).changes > 0;
}

export type ReviewError = "not_found" | "not_pending" | "own" | "note_required" | "forbidden";
export function review(reviewer: User, id: number, decision: "approved" | "rejected", note: string, main: DatabaseSync, acc: DatabaseSync = accountsDb()): { ok: true } | { ok: false; error: ReviewError } {
  if (reviewer.role !== "editor" && reviewer.role !== "admin") return { ok: false, error: "forbidden" };
  const c = acc.prepare("SELECT * FROM contributions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!c) return { ok: false, error: "not_found" };
  if (c.status !== "pending") return { ok: false, error: "not_pending" };
  if (c.user_id === reviewer.id && reviewer.role !== "admin") return { ok: false, error: "own" };
  const n = clean(note).slice(0, 500);
  if (decision === "rejected" && n.length < 5) return { ok: false, error: "note_required" };
  acc.prepare("UPDATE contributions SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?").run(decision, reviewer.id, nowIso(), n || null, id);
  audit(acc, reviewer.username, `contribution_${decision}`, `#${id}`, `${c.boxer_ext} ${c.role} ${c.person_name}`);
  if (decision === "approved") applyContributions(main, acc);
  return { ok: true };
}

/**
 * Makes the sports database match the approved edits: removes every "Community edit" team-history row and writes one per approved edit.
 * Idempotent, so it is safe to run whenever the database opens or is rebuilt. A person who is not already known is added as a new
 * person (external id community:<slug>); one who is (same name, ignoring case) is linked to the existing record.
 * Returns how many rows were written and how many approved edits could not be placed (their boxer is not in this database).
 */
export function applyContributions(main: DatabaseSync, acc: DatabaseSync | null = accountsDbIfAny()): { written: number; skipped: number } {
  if (!acc) return { written: 0, skipped: 0 };
  const approved = acc.prepare("SELECT * FROM contributions WHERE status = 'approved' ORDER BY id").all() as Record<string, unknown>[];
  let written = 0, skipped = 0;
  main.exec("BEGIN");
  try {
    main.prepare("DELETE FROM team_stints WHERE source = ?").run(EDIT_SOURCE);
    const findBoxer = main.prepare("SELECT id FROM boxers WHERE external_id = ?"), findPerson = main.prepare("SELECT id FROM people WHERE lower(name) = lower(?) ORDER BY id LIMIT 1");
    const slugTaken = main.prepare("SELECT 1 x FROM people WHERE slug = ?");
    const insPerson = main.prepare("INSERT INTO people (external_id, slug, name) VALUES (?,?,?) ON CONFLICT(external_id) DO UPDATE SET name = excluded.name RETURNING id");
    const ins = main.prepare("INSERT INTO team_stints (boxer_id, role, person_id, org_id, start_date, end_date, source, source_url, note) VALUES (?,?,?,NULL,?,?,?,?,?)");
    for (const c of approved) {
      const box = findBoxer.get(c.boxer_ext as string) as { id: number } | undefined;
      if (!box) { skipped++; continue; }
      let person = findPerson.get(c.person_name as string) as { id: number } | undefined;
      if (!person) {
        const base = slugify(c.person_name as string) || "person";
        let slug = base, n = 2;
        while (slugTaken.get(slug)) slug = `${base}-${n++}`;
        person = insPerson.get(`community:${base}`, slug, c.person_name as string) as { id: number };
      }
      ins.run(box.id, c.role as string, person.id, c.start_date as string, (c.end_date as string) ?? null, EDIT_SOURCE, c.source_url as string, (c.quote as string));
      written++;
    }
    main.exec("COMMIT");
  } catch (e) { main.exec("ROLLBACK"); throw e; }
  return { written, skipped };
}

import { getDb, bumpDbVersion } from "@/lib/db";
import { accountsDb } from "@/lib/accounts/store";
import { fail, isRole, json, postBody, str, userOf } from "@/lib/accounts/api";
import { limits } from "@/lib/accounts/guard";
import { acceptEverythingWaiting, decideGroup, proposalGroups, type GroupError } from "@/lib/watch/groups";
import { proposalCounts } from "@/lib/watch/proposals";
import { listRules } from "@/lib/watch/rules";
import { SOURCES } from "@/lib/watch/run";

const status: Record<GroupError, number> = { forbidden: 403, not_found: 404, not_pending: 409, unknown_source: 409, stale: 409, gone: 409, bad_proposal: 409, note_required: 400, too_many: 400, failed: 500, group_changed: 409, group_empty: 409 };

/** The waiting changes by group, with counts, statistics and samples, and the standing rules: ADMINS only. ?status=pending (default) | approved | rejected | superseded. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!isRole(user, "admin")) return fail(user ? "forbidden" : "unauthorized", user ? 403 : 401);
  const st = new URL(req.url).searchParams.get("status") ?? "pending";
  if (!["pending", "approved", "rejected", "superseded"].includes(st)) return fail("bad_request");
  const acc = accountsDb();
  return json({ groups: proposalGroups(acc, st), counts: proposalCounts(acc), rules: listRules(acc), sources: SOURCES.map((s) => ({ id: s.id, label: s.label, kind: s.kind, terms: s.terms })) });
}

/**
 * {action: "decide", source, kind, field, decision: "approved" | "rejected", note, expectCount}: every waiting proposal of that group. `expectCount` is the number the page showed:
 * if the group has changed since (409 group_changed) nothing is decided, so a proposal that arrived after the page loaded is never approved unseen.
 * {action: "baseline", note, expectCount}: accept everything the vendor's feed has waiting, in one logged step (a note is required).
 */
export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!isRole(user, "admin")) return fail(user ? "forbidden" : "unauthorized", user ? 403 : 401);
  if (!limits().write.take(`u${user.id}`)) return fail("rate_limited", 429);
  const b = r.body, expectCount = Number(b.expectCount);
  if (!Number.isInteger(expectCount) || expectCount < 1) return fail("bad_request");
  const main = await getDb(), acc = accountsDb();
  const res = b.action === "baseline" ? acceptEverythingWaiting(user, { note: str(b.note, 600), expectCount }, main, acc)
    : b.action === "decide" && typeof b.source === "string" && typeof b.kind === "string" && typeof b.field === "string" && (b.decision === "approved" || b.decision === "rejected")
      ? decideGroup(user, { source: b.source, kind: b.kind, field: b.field, decision: b.decision, note: str(b.note, 600), expectCount }, main, acc)
      : null;
  if (!res) return fail("bad_request");
  if ("error" in res) return fail(res.error, status[res.error]);
  if (res.report.changedData) bumpDbVersion();
  return json({ ok: true, approved: res.report.approved, rejected: res.report.rejected, failed: res.failed, ratingsRecomputed: res.report.ratingsRecomputed });
}

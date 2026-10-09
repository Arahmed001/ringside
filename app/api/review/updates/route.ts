import { getDb, bumpDbVersion } from "@/lib/db";
import { accountsDb } from "@/lib/accounts/store";
import { fail, isRole, json, postBody, str, userOf } from "@/lib/accounts/api";
import { limits } from "@/lib/accounts/guard";
import { listProposals, proposalCounts } from "@/lib/watch/proposals";
import { decide, MAX_BATCH, type DecideError } from "@/lib/watch/decide";
import { SOURCES } from "@/lib/watch/run";

const status: Record<DecideError, number> = { forbidden: 403, not_found: 404, not_pending: 409, unknown_source: 409, stale: 409, gone: 409, bad_proposal: 409, note_required: 400, too_many: 400, failed: 500 };

/** Changes that public sources seem to have made to data we hold, for ADMINS only: ?status=pending (default) | approved | rejected | superseded, and ?source=. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!isRole(user, "admin")) return fail(user ? "forbidden" : "unauthorized", user ? 403 : 401);
  const q = new URL(req.url).searchParams, acc = accountsDb();
  const st = q.get("status") ?? "pending";
  if (!["pending", "approved", "rejected", "superseded"].includes(st)) return fail("bad_request");
  const sources = SOURCES.map((s) => ({ id: s.id, label: s.label, kind: s.kind, terms: s.terms }));
  return json({ items: listProposals(acc, { status: st, source: q.get("source") ?? undefined }), counts: proposalCounts(acc), sources, max: MAX_BATCH });
}

/**
 * {ids: number[], decision: "approved" | "rejected", note}. Approving writes each change to the live data (and only an admin can); a change that no longer fits what is held
 * is refused with its own error in `results` and stays pending. Rejecting needs a note. At most 50 ids per call.
 */
export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!isRole(user, "admin")) return fail(user ? "forbidden" : "unauthorized", user ? 403 : 401);
  if (!limits().write.take(`u${user.id}`)) return fail("rate_limited", 429);
  const { ids, decision } = r.body;
  if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x)) || (decision !== "approved" && decision !== "rejected")) return fail("bad_request");
  const res = decide(user, ids as number[], decision, str(r.body.note, 600), await getDb(), accountsDb());
  if ("error" in res) return fail(res.error, status[res.error]);
  if (res.changedData) bumpDbVersion(); // the world rebuilds on the next request, so pages show the approved change at once
  return json({ ok: true, approved: res.approved, rejected: res.rejected, results: res.results });
}

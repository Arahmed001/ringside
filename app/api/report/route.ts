import { getDb, bumpDbVersion } from "@/lib/db";
import { recomputeRatings } from "@/lib/ingest";
import { myReports, submitReport, withdrawReport, type ReportInput } from "@/lib/accounts/corrections";
import { fail, json, postBody, str, userOf } from "@/lib/accounts/api";
import { limits } from "@/lib/accounts/guard";

/**
 * Reporting a wrong fact: GET lists your own reports, POST sends one, DELETE {id} withdraws one that is still open. Signed-in people only.
 * POST {kind: "error", boxerSlug | boutId, field, proposed, proposedMethod?, sourceUrl, quote, note?} for a correction, or
 *      {kind: "about_me", boxerSlug, note, contact?} for a person asking about their own details (goes to an admin, never applied).
 * A fighter whose account an admin has linked to their profile corrects their own details with no source: it is applied at once ({id, applied: true}).
 */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  return json({ items: myReports(user.id, await getDb()) });
}

export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  if (!limits().report.take(`u${user.id}`)) return fail("rate_limited", 429, { "retry-after": "86400" });
  const b = r.body, db = await getDb();
  const slug = str(b.boxerSlug, 120), bout = str(b.boutId, 120);
  const targetType = bout ? "bout" : "boxer";
  const targetExt = bout || ((db.prepare("SELECT external_id e FROM boxers WHERE slug = ?").get(slug) as { e: string } | undefined)?.e ?? "");
  const p: ReportInput = {
    kind: b.kind === "about_me" ? "about_me" : b.kind === "error" ? "error" : (undefined as never), targetType, targetExt, field: str(b.field, 30) || undefined,
    proposed: str(b.proposed, 120) || undefined, proposedMethod: str(b.proposedMethod, 10) || undefined,
    sourceUrl: str(b.sourceUrl, 600) || undefined, quote: str(b.quote, 400) || undefined, note: str(b.note, 1600) || undefined, contact: str(b.contact, 240) || undefined,
  };
  const res = submitReport(user, p, db);
  if (!res.ok) { limits().report.clear(`u${user.id}`); return fail(res.error, 400); } // a refused report does not use up the day's allowance
  if (res.applied) { if (res.applied.boutsChanged) recomputeRatings(db); bumpDbVersion(); } // the fighter's own correction is in place: pages show it at once
  return json({ id: res.id, applied: !!res.applied }, 201);
}

export async function DELETE(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  return withdrawReport(user, Number(r.body.id)) ? json({ ok: true }) : fail("not_found", 404);
}

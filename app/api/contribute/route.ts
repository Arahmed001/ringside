import { getDb } from "@/lib/db";
import { mine, submit, withdraw, type Proposal } from "@/lib/accounts/contributions";
import { fail, json, postBody, str, userOf } from "@/lib/accounts/api";
import { limits } from "@/lib/accounts/guard";

/** Proposing a change to a fighter's team history: GET lists your own, POST sends one, DELETE {id} withdraws a pending one. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  // reviewers' source checks are not shown to the person who proposed the edit
  return json({ items: mine(user.id, await getDb()).map((c) => ({ ...c, sourceCheck: null, sourceCheckedAt: null })) });
}

export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  if (limits().contribute.left(`u${user.id}`) < 1) return fail("rate_limited", 429, { "retry-after": "86400" }); // spent only by a proposal that is accepted (below)
  const b = r.body;
  const db = await getDb();
  const slug = str(b.boxerSlug, 120);
  const boxerExt = slug ? ((db.prepare("SELECT external_id e FROM boxers WHERE slug = ?").get(slug) as { e: string } | undefined)?.e ?? "") : str(b.boxerExt, 80);
  const p: Proposal = { boxerExt, role: str(b.role, 30), personName: str(b.personName, 120), start: str(b.start, 10), end: b.end ? str(b.end, 10) : null, sourceUrl: str(b.sourceUrl, 600), quote: str(b.quote, 400), note: str(b.note, 600) };
  const res = submit(user, p, db);
  if (!res.ok) return fail(res.error, 400); // a refused proposal does not use up the day's allowance (it was never taken; clearing would also forgive the accepted ones)
  limits().contribute.take(`u${user.id}`);
  return json({ id: res.id }, 201);
}

export async function DELETE(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  return withdraw(user, Number(r.body.id)) ? json({ ok: true }) : fail("not_found", 404);
}

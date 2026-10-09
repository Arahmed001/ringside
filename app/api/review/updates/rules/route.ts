import { accountsDb } from "@/lib/accounts/store";
import { fail, isRole, json, postBody, str, userOf } from "@/lib/accounts/api";
import { limits } from "@/lib/accounts/guard";
import { addRule, listRules, removeRule, ruleFields, type RuleError } from "@/lib/watch/rules";

const status: Record<RuleError, number> = { forbidden: 403, field_unknown: 400, condition_invalid: 400, amount_invalid: 400, duplicate: 409, not_found: 404 };

/** Standing rules for the vendor's changes, and the fields a rule can name: ADMINS only. */
export async function GET(req: Request) {
  const user = userOf(req);
  if (!isRole(user, "admin")) return fail(user ? "forbidden" : "unauthorized", user ? 403 : 401);
  return json({ rules: listRules(accountsDb()), fields: ruleFields() });
}

/** {field, condition: "any" | "fills" | "max_delta", amount?, note?}: a new standing rule. It applies from the next update, and every use is logged. */
export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!isRole(user, "admin")) return fail(user ? "forbidden" : "unauthorized", user ? 403 : 401);
  if (!limits().write.take(`u${user.id}`)) return fail("rate_limited", 429);
  const { field, condition, amount } = r.body;
  if (typeof field !== "string" || typeof condition !== "string") return fail("bad_request");
  const res = addRule(user, { field, condition, amount: typeof amount === "number" ? amount : null, note: str(r.body.note, 300) }, accountsDb());
  if (!res.ok) return fail(res.error, status[res.error]);
  return json({ ok: true, id: res.id }, 201);
}

/** ?id=: remove a rule. */
export async function DELETE(req: Request) {
  const user = userOf(req);
  if (!isRole(user, "admin")) return fail(user ? "forbidden" : "unauthorized", user ? 403 : 401);
  const { sameOrigin } = await import("@/lib/accounts/guard");
  if (!sameOrigin(req)) return fail("forbidden", 403);
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return fail("bad_request");
  const res = removeRule(user, id, accountsDb());
  if (!res.ok) return fail(res.error, status[res.error]);
  return json({ ok: true });
}

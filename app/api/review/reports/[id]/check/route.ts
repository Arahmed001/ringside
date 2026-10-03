import { runSourceCheck } from "@/lib/accounts/source-check";
import { accountsDb } from "@/lib/accounts/store";
import { canReview, fail, json, postBody, userOf } from "@/lib/accounts/api";
import { limits } from "@/lib/accounts/guard";

/** Has the quote on a report been said on the page it links to? Fetched by code, politely; shown to reviewers only. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!canReview(user)) return fail(user ? "forbidden" : "unauthorized", user ? 403 : 401);
  if (!limits().check.take(`u${user.id}`)) return fail("rate_limited", 429);
  const res = await runSourceCheck(Number((await ctx.params).id), user.username, accountsDb(), undefined, "reports");
  return res === "not_found" ? fail("not_found", 404) : json({ result: res });
}

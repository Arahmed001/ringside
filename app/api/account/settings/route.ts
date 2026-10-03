import { setPicksPublic } from "@/lib/accounts/users";
import { fail, json, postBody, userOf } from "@/lib/accounts/api";

export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  const user = userOf(req);
  if (!user) return fail("unauthorized", 401);
  if (typeof r.body.picksPublic !== "boolean") return fail("bad_request");
  setPicksPublic(user.id, r.body.picksPublic);
  return json({ ok: true });
}

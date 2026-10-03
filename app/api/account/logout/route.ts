import { endSession } from "@/lib/accounts/users";
import { clearCookie, cookieOf, json, postBody } from "@/lib/accounts/api";

export async function POST(req: Request) {
  const r = await postBody(req);
  if (r instanceof Response) return r;
  endSession(cookieOf(req));
  return json({ ok: true }, 200, { "set-cookie": clearCookie(req) });
}

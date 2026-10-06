import { apiRankings } from "@/lib/public-api";
import { preflight, respond } from "@/lib/public-api-http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
/** GET /api/v1/rankings/{division}?sex=&limit=&offset= : a division's ranking (see docs/public-api.md). */
export async function GET(req: Request, { params }: { params: Promise<{ division: string }> }) {
  const { division } = await params;
  return respond(req, (c, q) => apiRankings(c, division, q));
}

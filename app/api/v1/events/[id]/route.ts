import { apiEvent } from "@/lib/public-api";
import { preflight, respond } from "@/lib/public-api-http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
/** GET /api/v1/events/{id}: one event with its bouts (see docs/public-api.md). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return respond(req, (c) => apiEvent(c, id));
}

import { apiFighter } from "@/lib/public-api";
import { preflight, respond } from "@/lib/public-api-http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
/** GET /api/v1/fighters/{slug}: one fighter (see docs/public-api.md). */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return respond(req, (c) => apiFighter(c, slug));
}

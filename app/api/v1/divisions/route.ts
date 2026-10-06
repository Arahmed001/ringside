import { apiDivisions } from "@/lib/public-api";
import { preflight, respond } from "@/lib/public-api-http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
/** GET /api/v1/divisions: the divisions, lightest to heaviest (see docs/public-api.md). */
export const GET = (req: Request) => respond(req, () => apiDivisions());

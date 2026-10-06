import { apiFighters } from "@/lib/public-api";
import { preflight, respond } from "@/lib/public-api-http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
/** GET /api/v1/fighters?q=&division=&country=&sex=&active=&limit=&offset=&lang= (see docs/public-api.md). */
export const GET = (req: Request) => respond(req, (c, q) => apiFighters(c, q));

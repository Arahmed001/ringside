import { apiEvents } from "@/lib/public-api";
import { preflight, respond } from "@/lib/public-api-http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
/** GET /api/v1/events?when=upcoming|recent&limit=&offset= (see docs/public-api.md). */
export const GET = (req: Request) => respond(req, (c, q) => apiEvents(c, q));

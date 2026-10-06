import { openApiSpec } from "@/lib/public-api";
import { preflight, respond } from "@/lib/public-api-http";
import { siteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
/** GET /api/v1/openapi.json: the OpenAPI 3 description of the API. */
export const GET = (req: Request) => respond(req, () => ({ raw: openApiSpec(siteUrl()) }));

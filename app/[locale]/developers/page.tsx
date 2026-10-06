import { EmbedBuilder } from "@/components/EmbedBuilder";
import { DIVISIONS, slugifyDivision } from "@/lib/divisions";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";
import { API_DEFAULT_LIMIT, API_MAX_LIMIT, publicApiGate } from "@/lib/public-api";
import { API_LIMIT } from "@/lib/public-api-http";
import { siteUrl } from "@/lib/seo";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/developers", title: t("For developers"),
  description: t("Ringside's ratings, rankings and fights as read-only JSON, and cards you can frame on your own site."),
  noindex: !publicApiGate().open, // a page that says it is not available is nothing to find in a search
}));

const ENDPOINTS = [
  ["GET /api/v1/divisions", msg("Divisions, lightest to heaviest")],
  ["GET /api/v1/fighters?q=&division=&limit=", msg("Fighters: best rated first, or search by name")],
  ["GET /api/v1/fighters/:slug", msg("One fighter: record, rating, rank, last fights, next fight")],
  ["GET /api/v1/rankings/:division", msg("A division's ranking")],
  ["GET /api/v1/events?when=upcoming", msg("Upcoming or recent events")],
  ["GET /api/v1/events/:id", msg("One event with its bouts and results")],
  ["GET /api/v1/openapi.json", msg("The <c>OpenAPI</c> description")],
] as const;

/** The page for people who want Ringside's data on their own site: the API, and a builder for the embeddable cards. Shows only what the switch allows (lib/public-api.ts). */
export default async function Developers() {
  const t = await getT();
  const gate = publicApiGate();
  if (!gate.open) return (
    <div className="max-w-3xl space-y-4">
      <div className="eyebrow">{t("For developers")}</div>
      <h1 className="font-display text-5xl font-extrabold uppercase">{t("Developers")}</h1>
      <p className="text-muted">{t("The public API and the embeds are not available on this site.")}</p>
    </div>
  );
  // technical words stay English in both languages: marked as such, so a screen reader says them in English and the Arabic page is not flagged for them
  const c = (chunks: React.ReactNode) => <code lang="en" dir="ltr" className="rounded bg-panel2 px-1 py-0.5 text-xs">{chunks}</code>;
  const divisions = DIVISIONS.map((d) => ({ slug: slugifyDivision(d.name), label: t(d.name) }));
  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <div className="eyebrow mb-2">{t("For developers")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Developers")}</h1>
        <p className="mt-2 text-muted">{t("Read-only JSON, and cards you can frame on your own site. Please keep the link back and the credit on a card, and keep to {limit} requests a minute.", { limit: API_LIMIT })}</p>
      </div>
      <section aria-labelledby="api-title" className="space-y-3">
        <h2 id="api-title" className="font-display text-3xl font-bold uppercase">{t("Public API")}</h2>
        <p className="text-sm text-muted">{t.rich("Every answer is JSON with a data part and a meta part, in English or Arabic (<c>lang=ar</c>). Pages of {max} at most, {n} by default. Open to any site (CORS), cached for five minutes.", { c, max: API_MAX_LIMIT, n: API_DEFAULT_LIMIT })}</p>
        <ul className="card divide-y divide-line/60 text-sm">
          {ENDPOINTS.map(([path, what]) => (
            <li key={path} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5">
              <code lang="en" dir="ltr" className="rounded bg-panel2 px-1.5 py-0.5 text-xs">{path}</code>
              <span className="text-muted">{t.rich(what, { c })}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="embed-title" className="space-y-3">
        <h2 id="embed-title" className="font-display text-3xl font-bold uppercase">{t("Embeds")}</h2>
        <p className="text-sm text-muted">{t("Choose a card, copy the code, paste it into your page.")}</p>
        <EmbedBuilder base={siteUrl()} divisions={divisions} />
      </section>
    </div>
  );
}

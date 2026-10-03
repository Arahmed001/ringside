import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { getDb } from "@/lib/db";
import { ContributeForm } from "@/components/ContributeForm";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/contribute", title: t("Suggest an edit"), description: t("Add or correct who trains or manages a fighter, with a source an editor can check."), noindex: true,
}));

export default async function Contribute({ searchParams }: { searchParams: Promise<{ boxer?: string }> }) {
  const t = await getT();
  const { boxer } = await searchParams;
  const row = boxer ? ((await getDb()).prepare("SELECT slug, name FROM boxers WHERE slug = ?").get(boxer.slice(0, 120)) as { slug: string; name: string } | undefined) : undefined;
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Team history")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Suggest an edit")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Know who trains or manages a fighter, or since when? Tell us, with the page that says so. An editor reads the source before anything is published, and what is published is marked as a community edit with its link.")}</p>
      </div>
      <ContributeForm initial={row ? { slug: row.slug, name: t.name(row.name) } : undefined} />
    </div>
  );
}

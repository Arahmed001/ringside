import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { getDb } from "@/lib/db";
import { currentValue } from "@/lib/accounts/corrections";
import { ReportForm, type ReportBout } from "@/components/ReportForm";
import { siteContact } from "@/lib/site-info";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/report", title: t("Report a mistake"), description: t("Tell us a fact on a fighter or fight page is wrong, with the source that says so."), noindex: true,
}));

export default async function Report({ searchParams }: { searchParams: Promise<{ boxer?: string; bout?: string }> }) {
  const t = await getT();
  const { boxer, bout } = await searchParams;
  const db = await getDb();
  const row = boxer ? (db.prepare("SELECT slug, name FROM boxers WHERE slug = ?").get(boxer.slice(0, 120)) as { slug: string; name: string } | undefined) : undefined;
  const b = bout && /^\d{1,9}$/.test(bout)
    ? (db.prepare("SELECT x.external_id ext, x.rounds, x.method, r.name rn, u.name un FROM bouts x JOIN boxers r ON r.id = x.red_id JOIN boxers u ON u.id = x.blue_id WHERE x.id = ?").get(Number(bout)) as { ext: string; rounds: number | null; method: string | null; rn: string; un: string } | undefined)
    : undefined;
  const fight: ReportBout | undefined = b?.ext && b.method ? { ext: b.ext, red: t.name(b.rn), blue: t.name(b.un), rounds: b.rounds, result: currentValue(db, "bout", b.ext, "result") } : undefined;
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Corrections")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Report a mistake")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Spotted something wrong? Tell us, with the page that says so. An editor reads the source before anything changes, and nothing appears on a page just because someone reported it. Results of fights come from the commission or sanctioning body that ran them; a fighter’s own details come from the fighter.")}</p>
      </div>
      <ReportForm initial={row ? { slug: row.slug, name: t.name(row.name) } : undefined} bout={fight} contact={siteContact()} />
    </div>
  );
}

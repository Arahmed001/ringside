import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { ReportQueue } from "@/components/ReportQueue";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/review/reports", title: t("Reports of mistakes"), description: t("Editors check reports of wrong facts against sources published by their owners."), noindex: true,
}));

export default async function ReviewReports() {
  const t = await getT();
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Editors")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Reports of mistakes")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("A fight’s result can only be corrected from a page its commission or sanctioning body published; a fighter’s details from the fighter’s own page or their confirmed account. Anything else can be noted, and the data feed’s value stands. You cannot decide your own report.")}</p>
        <p className="mt-3 flex gap-4 text-sm"><Link href="/review" className="underline decoration-dotted hover:text-ink">{t("Team-history edits")}</Link><Link href="/review/forum" className="underline decoration-dotted hover:text-ink">{t("Forum moderation")}</Link></p>
      </div>
      <ReportQueue />
    </div>
  );
}

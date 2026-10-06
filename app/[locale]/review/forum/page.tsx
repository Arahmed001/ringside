import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { ForumQueue } from "@/components/ForumQueue";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/review/forum", title: t("Forum moderation"), description: t("Editors look at reported forum posts and the newest posts, and hide or restore them."), noindex: true,
}));

export default async function ReviewForum() {
  const t = await getT();
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Editors")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Forum moderation")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Posts that people reported come first. Hiding a post keeps its place and removes its words and its author from view; restoring puts it back. Every action is written to the activity log.")}</p>
        <p className="mt-3 flex gap-4 text-sm"><Link href="/review" className="underline decoration-dotted hover:text-ink">{t("Team-history edits")}</Link><Link href="/review/reports" className="underline decoration-dotted hover:text-ink">{t("Reports of mistakes")}</Link><Link href="/forum/rules" className="underline decoration-dotted hover:text-ink">{t("Forum rules")}</Link></p>
      </div>
      <ForumQueue />
    </div>
  );
}

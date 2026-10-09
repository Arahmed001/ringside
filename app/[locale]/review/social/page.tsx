import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { SocialQueue } from "@/components/SocialQueue";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/review/social", title: t("Chosen posts"), description: t("Editors choose public posts from official accounts to show on fighter and card pages."), noindex: true,
}));

export default async function ReviewSocial() {
  const t = await getT();
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Editors")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Chosen posts")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Paste the link to one public post by an official account on YouTube, X, Reddit, Instagram or Facebook, and say where it shows. A visitor sees only the account and your note until they press the button; then the platform's own player or embed opens. Only choose posts by accounts you have checked are the real ones.")}</p>
        <p className="mt-3 flex gap-4 text-sm"><Link href="/review" className="underline decoration-dotted hover:text-ink">{t("Team-history edits")}</Link><Link href="/review/forum" className="underline decoration-dotted hover:text-ink">{t("Forum moderation")}</Link></p>
      </div>
      <SocialQueue />
    </div>
  );
}

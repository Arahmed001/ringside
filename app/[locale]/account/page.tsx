import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { AccountPanel } from "@/components/AccountPanel";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/account", title: t("Your account"), description: t("Sign in to keep your picks on every device, join the leaderboard and suggest corrections."), noindex: true,
}));

export default async function Account() {
  const t = await getT();
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Ringside")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Your account")}</h1>
      </div>
      <AccountPanel />
    </div>
  );
}

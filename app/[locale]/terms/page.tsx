import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { siteContact } from "@/lib/site-info";
import Link from "@/components/L";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/terms", title: t("Terms"),
  description: t("The small print: what the ratings and data are and are not, how accounts and contributions work, and where to write about a correction."),
}));

/**
 * The small print, and deliberately only here (decided 2026-10-06): the terms of use and the line about corrections and removal live on this page, in small type,
 * and are not repeated on the pages people read. The contact is the site's own (SITE_CONTACT); with none set the page says to ask whoever runs the site.
 */
export default async function Terms() {
  const t = await getT();
  const contact = siteContact();
  const h = "font-semibold text-ink/80";
  return (
    <div className="max-w-3xl space-y-6 text-xs leading-relaxed text-muted">
      <div>
        <div className="eyebrow mb-1">{t("The small print")}</div>
        <h1 className="font-display text-3xl font-extrabold uppercase text-ink/90">{t("Terms")}</h1>
      </div>
      <section aria-labelledby="t-use" className="space-y-1.5">
        <h2 id="t-use" className={h}>{t("Using Ringside")}</h2>
        <p>{t("Ringside is a boxing statistics site. Its ratings and win probabilities are the site’s own calculations from public results: they are estimates for information and entertainment, not betting, financial or any other advice, and they are not official rankings.")}</p>
        <p>{t("Ringside is independent. It is not affiliated with, endorsed by or sponsored by any sanctioning body, promoter, broadcaster, fighter or data supplier named on it. Their names and marks belong to them.")}</p>
      </section>
      <section aria-labelledby="t-data" className="space-y-1.5">
        <h2 id="t-data" className={h}>{t("The data")}</h2>
        <p>{t("Fight, fighter and event data comes from the suppliers listed on the Data page and may be incomplete or wrong. Where a record is known to be partial or disputed, the page says so. Please do not copy the data in bulk; where the site offers a public API, use that, within its limits.")}</p>
      </section>
      <section aria-labelledby="t-acc" className="space-y-1.5">
        <h2 id="t-acc" className={h}>{t("Accounts and contributions")}</h2>
        <p>{t("An account keeps your picks and watchlist. If you propose an edit, you confirm that you may share the source you give; an editor decides whether it is published. An account used to abuse the site may be closed.")}</p>
      </section>
      <section aria-labelledby="t-none" className="space-y-1.5">
        <h2 id="t-none" className={h}>{t("No guarantee")}</h2>
        <p>{t("The site is provided as it is, and may be unavailable or wrong at times.")}</p>
      </section>
      <section aria-labelledby="t-fix" className="space-y-1.5">
        <h2 id="t-fix" className={h}>{t("Corrections and removal")}</h2>
        <p>{contact ? <>{t("To ask for a correction, or for personal details about you to be reviewed for removal, write to")} <a href={contact.href} lang="en" dir="ltr" className="underline decoration-dotted hover:text-gold" {...(contact.href.startsWith("mailto:") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>{contact.label}</a>. {t("Each request is considered.")}</> : t("No contact address has been set for this site. Ask whoever runs it.")}</p>
        <p>{t.rich("What the site keeps about people who make an account is on the <a>Privacy</a> page.", { a: (c) => <Link href="/privacy" className="underline decoration-dotted hover:text-gold">{c}</Link> })}</p>
      </section>
    </div>
  );
}

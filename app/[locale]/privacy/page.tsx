import { getWorld } from "@/lib/world";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { hasKey } from "@/lib/ai";
import { isDemoData } from "@/lib/seo";
import { siteContact } from "@/lib/site-info";
import { AI_USES, HELD, STORAGE_KEYS, pictureHosts } from "@/lib/privacy";
import { RESET_MINUTES, SESSION_COOKIE, SESSION_DAYS } from "@/lib/accounts/users";
import { DEFAULT_BACKUPS_KEPT } from "@/lib/backup";
import Link from "@/components/L";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/privacy", title: t("Privacy"),
  description: t("What this site keeps about you, who can see it, what it sends elsewhere, and how to get your data or delete it."),
}));

/**
 * Written from the code, not from memory: what is kept (lib/privacy.ts, checked against the real schema and sources by tests/privacy.test.ts), the numbers
 * the code uses (session days, one-time code minutes, backups kept) and how this deployment is configured (a model key, picture hosts, a contact).
 */
export default async function Privacy() {
  const t = await getT();
  const w = await getWorld();
  const hosts = pictureHosts(w), contact = siteContact();
  const li = "ps-1";
  // English by nature (a cookie name, a device label): marked so a screen reader says it in English and the Arabic page is not flagged for English words
  const code = (c: React.ReactNode) => <code lang="en" dir="ltr" className="rounded bg-panel2 px-1.5 py-0.5 text-sm">{c}</code>;
  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <div className="eyebrow mb-2">{t("Your data")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Privacy")}</h1>
        <p className="mt-3 text-lg text-muted">{t("The short version: you can read everything here without an account and without being tracked. If you make an account, this page lists exactly what is kept, who can see it, and how to take it with you or delete it.")}</p>
        {isDemoData() && <p className="mt-3 rounded-xl border border-line bg-panel px-4 py-3 text-sm text-muted">{t("This is a demonstration with fictional fighters, but accounts made here are real accounts on this server and are treated exactly as described below.")}</p>}
      </div>

      <section aria-labelledby="reading" className="space-y-3">
        <h2 id="reading" className="font-display text-3xl font-bold uppercase">{t("If you only read")}</h2>
        <ul className="list-disc space-y-2 ps-6 marker:text-muted">
          <li className={li}>{t("There are no analytics, advertising or tracking scripts, and no script, style, font or frame is loaded from any other website.")}</li>
          <li className={li}>{t("No cookie is set unless you sign in.")}</li>
          <li className={li}>{t("Your browser keeps a few things for you, on your device only (the site’s server never receives them). Clear this site’s data in your browser to remove them:")}
            <ul className="mt-1 list-[circle] space-y-1 ps-6">{STORAGE_KEYS.map((s) => <li key={s.key}><code lang="en" dir="ltr" className="rounded bg-panel2 px-1.5 py-0.5 text-sm">{s.key}</code>: {t(s.what)}</li>)}</ul>
          </li>
          <li className={li}>{t("The site sees your network address when you make a request. It is used in memory to limit how fast one visitor can ask for things (and how often the AI features are used) and is not written down by this software. Whoever hosts the site may keep ordinary access logs of their own.")}</li>
          <li className={li}>{t("When a page fails, one line is logged with the page’s address (without anything after the “?”), what went wrong and a reference number. It has no cookie, header, address or account in it.")}</li>
        </ul>
      </section>

      <section aria-labelledby="account" className="space-y-3">
        <h2 id="account" className="font-display text-3xl font-bold uppercase">{t("If you create an account")}</h2>
        <p className="text-muted">{t("You need only a name and a password: no email address, so there is nothing to verify and no way to recover a forgotten password except by asking the operator for a one-time code, which works for {n} minutes.", { n: RESET_MINUTES })}</p>
        <p>{t.rich("One cookie, “<c>{name}</c>”, keeps you signed in for {days} days. It cannot be read by scripts on the page, is not sent along with requests from other websites, and is marked secure when the site is served over https. It is used for nothing else.", { name: SESSION_COOKIE, days: SESSION_DAYS, c: code })}</p>
        <p className="font-semibold">{t("What is kept about you:")}</p>
        <ul className="list-disc space-y-2 ps-6 marker:text-muted">
          {Object.entries(HELD).map(([table, h]) => <li key={table} className={li}>{t.rich(h.what, { c: code })}.</li>)}
        </ul>
      </section>

      <section aria-labelledby="see" className="space-y-3">
        <h2 id="see" className="font-display text-3xl font-bold uppercase">{t("Who can see it")}</h2>
        <ul className="list-disc space-y-2 ps-6 marker:text-muted">
          <li className={li}>{t("Everyone: your name and your pick’em score, on the leaderboard, if you chose to be on it (you can leave it at any time). Never your individual picks.")}</li>
          <li className={li}>{t("Editors and administrators: proposals and reports you send, with your name and any contact you gave, so they can follow them up.")}</li>
          <li className={li}>{t("Everyone, without your name: an edit that was approved is published on the fighter’s page with its source.")}</li>
          <li className={li}>{t("Whoever runs the server can read the database itself, including the activity log.")}</li>
        </ul>
      </section>

      <section aria-labelledby="controls" className="space-y-3">
        <h2 id="controls" className="font-display text-3xl font-bold uppercase">{t("Your controls")}</h2>
        <p>{t("On your account page you can download everything held about you as a file, see where you are signed in and end any of those sessions, leave the leaderboard, change your password, and delete the account.")} <Link href="/account" className="underline decoration-dotted hover:text-gold">{t("Your account")}</Link></p>
      </section>

      <section aria-labelledby="deleting" className="space-y-3">
        <h2 id="deleting" className="font-display text-3xl font-bold uppercase">{t("What deleting removes, and what stays")}</h2>
        <ul className="list-disc space-y-2 ps-6 marker:text-muted">
          <li className={li}>{t("Removed at once: your name, password hash, picks, watchlist, sign-ins, one-time codes and any fighter linked to you. The contact you gave on a report is erased, and in the activity log your name is replaced by “deleted account”.")}</li>
          <li className={li}>{t("Stays, without you: proposals and reports you sent (they are an editorial record about fighters, not about you), and edits that were already published. Do not put personal details in their notes.")}</li>
          <li className={li}>{t("Backups: the operator keeps copies of the databases (by default the last {n} daily ones). A copy made before you deleted your account still holds your data until it is rotated out.", { n: DEFAULT_BACKUPS_KEPT })}</li>
        </ul>
      </section>

      <section aria-labelledby="elsewhere" className="space-y-3">
        <h2 id="elsewhere" className="font-display text-3xl font-bold uppercase">{t("What is sent to other services")}</h2>
        {hasKey() ? (
          <>
            <p>{t("This site is set up to use an AI service (Anthropic’s API) for some features. What is sent to it, and only this, is:")}</p>
            <ul className="list-disc space-y-2 ps-6 marker:text-muted">{AI_USES.map((u) => <li key={u.files[0]} className={li}>{t(u.what)}.</li>)}</ul>
            <p className="text-muted">{t("It is sent without your name, address or account, and the service’s own terms apply to it. Without the AI service every feature still works with built-in rules.")}</p>
          </>
        ) : (
          <p>{t("This site is not set up to use an AI service: nothing you type is sent to any other company. Search and questions are answered by built-in rules.")}</p>
        )}
        {hosts.length ? (
          <p>{t("Some fighter photos and event posters are loaded from other websites:")} <span lang="en" dir="ltr">{hosts.join(", ")}</span>. {t("Your browser contacts them directly, so they can see your network address and that you opened a page here (the site asks your browser to tell them only the site’s address, not which page).")}</p>
        ) : (
          <p>{t("All pictures on this site come from this site itself.")}</p>
        )}
        <p>{t("When an editor checks a link that someone proposed as a source, the server (not your browser) fetches that page.")}</p>
      </section>

      <section aria-labelledby="who" className="space-y-3">
        <h2 id="who" className="font-display text-3xl font-bold uppercase">{t("Questions, and who is responsible")}</h2>
        <p>{contact ? <>{t("To ask about your data, write to")} <a href={contact.href} lang="en" dir="ltr" className="underline decoration-dotted hover:text-gold" {...(contact.href.startsWith("mailto:") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>{contact.label}</a>.</> : t("No contact address has been set for this site. Ask whoever runs it.")}</p>
        <p className="text-sm text-muted">{t("This page describes what the software does. The person who runs the site decides how long backups and access logs are kept and is responsible for following the laws that apply to them.")}</p>
      </section>
    </div>
  );
}

"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "@/components/L";
import { useT } from "@/components/i18n";
import { FighterPicker } from "@/components/FighterPicker";
import { api, useAccount } from "@/lib/useAccount";
import { explain } from "@/lib/account-text";
import { fieldLabel, namesOf, statusLabel, valueText } from "@/lib/correction-text";
import { METHODS, METHOD_NAME } from "@/lib/methods";
import type { ReportView } from "@/lib/accounts/corrections";

const input = "w-full rounded-xl border border-line bg-panel2 px-3 py-2.5 text-sm outline-none placeholder:text-muted focus:border-gold/60";
const label = "mb-1 block text-xs uppercase tracking-widest text-muted";
const BOXER_FIELDS = ["birth_date", "height_cm", "reach_cm", "stance", "nickname", "country", "other"] as const;
const BOUT_FIELDS = ["result", "method", "end_round", "other"] as const;
type Kind = "error" | "about_me";

export interface ReportBout { ext: string; red: string; blue: string; rounds: number | null; result: string | null }

/**
 * Report a wrong fact. Whose word counts depends on who owns the fact: a fight's result belongs to the commission that ran it, a fighter's details to the
 * fighter. So the form asks for a source, says which sources the site can use, and tells a verified fighter that their own corrections apply at once.
 */
export function ReportForm({ initial, bout, contact }: { initial?: { slug: string; name: string }; bout?: ReportBout; contact?: { label: string; href: string } | null }) {
  const t = useT();
  const me = useAccount();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [mine, setMine] = useState<ReportView[] | null>(null);
  const [owned, setOwned] = useState<{ slug: string; name: string }[]>([]);
  const [kind, setKind] = useState<Kind>("error");
  const [field, setField] = useState<string>(bout ? "result" : "reach_cm");
  const [formKey, setFormKey] = useState(0);

  const load = useCallback(() => { void api<{ items: ReportView[]; owned: { slug: string; name: string }[] }>("/api/report", "GET").then((r) => { if (r.ok) { setMine(r.data.items); setOwned(r.data.owned ?? []); } }); }, []);
  useEffect(() => { if (me) load(); }, [me, load]);

  if (me === undefined) return <p className="text-sm text-muted">{t("Loading…")}</p>;
  if (!me) return (
    <div className="card p-6">
      <p className="text-muted">{t("Sign in to report a mistake. Every report goes to an editor, who checks the source before anything changes.")}</p>
      <p className="mt-3"><Link href="/account" className="chip !border-gold/40 hover:!text-gold">{t("Sign in or create an account")}</Link></p>
      {contact && <p className="mt-4 text-sm text-muted">{t("Prefer not to sign in? Write to")} <a href={contact.href} lang="en" dir="ltr" {...(contact.href.startsWith("mailto:") ? {} : { target: "_blank", rel: "noopener noreferrer" })} className="underline decoration-dotted hover:text-ink">{contact.label}</a></p>}
    </div>
  );

  const isOwn = !!initial && owned.some((o) => o.slug === initial.slug) && !bout; // a verified fighter correcting their own details: no source needed
  const fields = bout ? BOUT_FIELDS : BOXER_FIELDS;
  const needsSource = kind === "error" && field !== "other" && !(isOwn);
  const methodLabel = (m: string) => t(METHOD_NAME[m as keyof typeof METHOD_NAME]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim();
    setBusy(true); setMsg(null);
    const body: Record<string, unknown> = bout ? { boutId: bout.ext } : { boxerSlug: v("boxer") };
    if (kind === "about_me") Object.assign(body, { kind, note: v("note"), contact: v("contact") });
    else Object.assign(body, { kind, field, proposed: v("proposed"), proposedMethod: v("proposedMethod") || undefined, sourceUrl: v("url"), quote: v("quote"), note: v("note") });
    const r = await api<{ id: number; applied: boolean }>("/api/report", "POST", body);
    setBusy(false);
    if (!r.ok) { setMsg({ text: explain(t, r.data.error), bad: true }); return; }
    setMsg({ text: r.data.applied ? t("Done. The correction is on your profile now. Editors can look it over afterwards.") : kind === "about_me" ? t("Thank you. An administrator will read this and get back to you if you left a contact.") : t("Thank you. An editor will check the source. Nothing on the page changes until then."), bad: false });
    setFormKey((k) => k + 1); load();
  }
  async function withdraw(id: number) { await api("/api/report", "DELETE", { id }); load(); }

  const valueInput = () => {
    if (field === "other") return null;
    if (field === "birth_date") return <input id="r-val" aria-label={t("What it should say")} name="proposed" type="date" required className={input} />;
    if (field === "height_cm" || field === "reach_cm") return <input id="r-val" aria-label={t("What it should say")} name="proposed" type="number" inputMode="numeric" min={120} max={260} required className={input} />;
    if (field === "stance") return <select id="r-val" name="proposed" required defaultValue="Orthodox" className={input}><option value="Orthodox">{t("Orthodox")}</option><option value="Southpaw">{t("Southpaw")}</option><option value="Switch">{t("Switch")}</option></select>;
    if (field === "nickname" || field === "country") return <input id="r-val" aria-label={t("What it should say")} name="proposed" required maxLength={60} className={input} autoComplete="off" />;
    if (field === "end_round") return <input id="r-val" aria-label={t("What it should say")} name="proposed" type="number" inputMode="numeric" min={1} max={bout?.rounds ?? 12} required className={input} />;
    if (field === "method") return <select id="r-val" name="proposed" required defaultValue="" className={input}><option value="" disabled>{t("Choose…")}</option>{METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</select>;
    return ( // result: who won, and how it ended
      <div className="grid gap-3 sm:grid-cols-2">
        <select id="r-val" name="proposed" required defaultValue="" className={input} aria-label={t("Who won")}>
          <option value="" disabled>{t("Who won?")}</option>
          <option value="red">{bout?.red}</option><option value="blue">{bout?.blue}</option><option value="draw">{t("Draw")}</option><option value="nc">{t("No contest")}</option>
        </select>
        <select name="proposedMethod" defaultValue="" className={input} aria-label={t("How it ended")}>
          <option value="">{t("How it ended (if it changes)")}</option>{METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
        </select>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {owned.length > 0 && !bout && (
        <div className="card p-5 text-sm">
          <div className="eyebrow mb-2">{t("Your profile")}</div>
          <p className="text-muted">{t("An administrator has confirmed that you are, or act for, these fighters. Your corrections to their own details (not to fights) are applied at once, without a source.")}</p>
          <ul className="mt-3 flex flex-wrap gap-2">{owned.map((o) => <li key={o.slug}><Link href={`/report?boxer=${o.slug}`} className="chip !border-gold/40 hover:!text-gold">{o.name}</Link></li>)}</ul>
        </div>
      )}

      <form key={formKey} onSubmit={submit} className="card grid gap-4 p-5 md:grid-cols-2" aria-label={t("Report a mistake")}>
        {bout ? (
          <div className="md:col-span-2">
            <span className={label}>{t("Fight")}</span>
            <p className="text-sm font-semibold">{bout.red} {t("vs")} {bout.blue}</p>
            {bout.result && <p className="text-xs text-muted">{t("The site shows: {value}", { value: valueText(t, "result", bout.result, [bout.red, bout.blue]) })}</p>}
          </div>
        ) : (
          <div className="md:col-span-2">
            <span className={label}>{t("Fighter")}</span>
            <FighterPicker name="boxer" label="" placeholder={t("Search for a fighter…")} initial={initial} />
          </div>
        )}

        {!bout && (
          <fieldset className="md:col-span-2">
            <legend className={label}>{t("What is this about?")}</legend>
            <div className="flex flex-wrap gap-2 text-sm">
              {([["error", t("Something on the profile is wrong")], ["about_me", t("This is about me")]] as [Kind, string][]).map(([k, text]) => (
                <label key={k} className={`cursor-pointer rounded-full border px-3 py-1 ${kind === k ? "border-gold/60 text-ink" : "border-line text-muted hover:text-ink"}`}>
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />{text}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {kind === "about_me" ? (
          <>
            <p className="text-sm text-muted md:col-span-2">{t("If you are this fighter, or act for them, tell us. This goes to an administrator only. Nothing is changed by it: an administrator checks who you are first, and can then link your account to the profile.")}</p>
            <div className="md:col-span-2">
              <label htmlFor="r-note" className={label}>{t("What you want to tell us")}</label>
              <textarea id="r-note" name="note" required minLength={20} maxLength={1500} rows={4} className={input} />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="r-contact" className={label}>{t("How to reach you (optional, seen by an administrator only)")}</label>
              <input id="r-contact" name="contact" maxLength={200} className={input} autoComplete="off" />
            </div>
          </>
        ) : (
          <>
            <div>
              <label htmlFor="r-field" className={label}>{t("What is wrong")}</label>
              <select id="r-field" value={field} onChange={(e) => setField(e.target.value)} className={input}>{fields.map((f) => <option key={f} value={f}>{fieldLabel(t, f)}</option>)}</select>
            </div>
            {field !== "other" && <div><label htmlFor="r-val" className={label}>{t("What it should say")}</label>{valueInput()}</div>}

            {field !== "other" && (
              <p className="rounded-xl border border-line bg-panel2/50 p-3 text-xs text-muted md:col-span-2">
                {bout ? t("A fight’s result is the commission’s or sanctioning body’s to state. Give a page they published (a commission’s results or official record). Other sources are kept as a note, but cannot change what the site shows.")
                  : isOwn ? t("You are confirmed as this fighter, so this is applied at once and needs no source.")
                  : t("A fighter’s details are the fighter’s to state. Give the fighter’s own official page. Other sources are kept as a note, but cannot change what the site shows. If you are this fighter, choose “This is about me”.")}
              </p>
            )}
            {field !== "other" && (
              <>
                <div className="md:col-span-2">
                  <label htmlFor="r-url" className={label}>{isOwn ? t("Source page (optional)") : t("Source page")}</label>
                  <input id="r-url" name="url" type="url" required={needsSource} maxLength={500} className={input} placeholder="https://" inputMode="url" dir="ltr" />
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="r-quote" className={label}>{isOwn ? t("The words on that page that say it (optional)") : t("The words on that page that say it")}</label>
                  <textarea id="r-quote" name="quote" required={needsSource} minLength={isOwn ? undefined : 12} maxLength={300} rows={3} className={input} aria-describedby="r-quote-hint" />
                  <p id="r-quote-hint" className="mt-1 text-xs text-muted">{t("Copy them exactly, up to 300 characters. Editors check that they are really on the page.")}</p>
                </div>
              </>
            )}
            <div className="md:col-span-2">
              <label htmlFor="r-note" className={label}>{field === "other" ? t("What is wrong") : t("Anything else the editor should know (optional)")}</label>
              <textarea id="r-note" name="note" required={field === "other"} minLength={field === "other" ? 20 : undefined} maxLength={1500} rows={field === "other" ? 4 : 2} className={input} />
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <button className="rounded-xl bg-red-btn px-5 py-2.5 font-display text-lg font-bold uppercase text-white transition hover:brightness-90 disabled:opacity-60" disabled={busy}>{isOwn && kind === "error" ? t("Correct it now") : t("Send for review")}</button>
          <span role="status" aria-live="polite" className={`text-sm ${msg?.bad ? "text-red-ink" : "text-win"}`}>{msg?.text}</span>
        </div>
      </form>

      <section aria-labelledby="my-reports">
        <h2 id="my-reports" className="mb-3 font-display text-3xl font-bold uppercase">{t("Your reports")}</h2>
        {mine === null ? <p className="text-sm text-muted">{t("Loading…")}</p> : mine.length === 0 ? <p className="text-sm text-muted">{t("You have not reported anything yet.")}</p> : (
          <ul className="space-y-2">
            {mine.map((r) => (
              <li key={r.id} className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  <span className="block font-semibold">{r.kind === "about_me" ? t("About me") : fieldLabel(t, r.field)} · {r.targetType === "boxer" && r.targetSlug ? <Link href={`/boxers/${r.targetSlug}`} className="underline decoration-dotted hover:text-ink">{r.targetName}</Link> : r.targetName}</span>
                  {r.kind === "error" && r.field && r.field !== "other" && <span className="block text-xs text-muted">{valueText(t, r.field, r.shown, namesOf(r.targetName))} → {valueText(t, r.field, r.proposed, namesOf(r.targetName))}</span>}
                  {r.byOwner && <span className="mt-1 block text-xs text-muted">{t("Provided by the fighter")}</span>}
                  {r.reviewNote && !r.byOwner && <span className="mt-1 block text-xs text-muted">{t("Editor’s note: {note}", { note: r.reviewNote })}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className={`chip ${r.status === "accepted" ? "!border-win/50 !text-win" : r.status === "rejected" ? "!border-red/50 !text-red-ink" : ""}`}>{statusLabel(t, r.status, r.state)}</span>
                  {r.status === "open" && <button className="text-xs underline decoration-dotted hover:text-ink" onClick={() => void withdraw(r.id)}>{t("Withdraw")}</button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

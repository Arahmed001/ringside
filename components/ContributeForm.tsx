"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "@/components/L";
import { useT } from "@/components/i18n";
import { FighterPicker } from "@/components/FighterPicker";
import { api, useAccount } from "@/lib/useAccount";
import { explain } from "@/components/accountText";
import type { ContributionView } from "@/lib/accounts/contributions";

const input = "w-full rounded-xl border border-line bg-panel2 px-3 py-2.5 text-sm outline-none placeholder:text-muted focus:border-gold/60";
const ROLES = [["head_trainer", "Head trainer"], ["assistant_trainer", "Assistant trainer"], ["strength_coach", "Strength & conditioning"], ["cutman", "Cutman"], ["manager", "Manager"]] as const;

/** Propose a change to a fighter's team history. Needs a link and the words from the page: an editor checks them before anything is published. */
export function ContributeForm({ initial }: { initial?: { slug: string; name: string } }) {
  const t = useT();
  const me = useAccount();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [mineList, setMine] = useState<ContributionView[] | null>(null);
  const [formKey, setFormKey] = useState(0);
  const roleLabel: Record<string, string> = { head_trainer: t("Head trainer"), assistant_trainer: t("Assistant trainer"), strength_coach: t("Strength"), cutman: t("Cutman"), manager: t("Manager") };
  const statusLabel: Record<string, string> = { pending: t("Waiting for review"), approved: t("Approved"), rejected: t("Not accepted"), withdrawn: t("Withdrawn") };

  const load = useCallback(() => { void api<{ items: ContributionView[] }>("/api/contribute", "GET").then((r) => { if (r.ok) setMine(r.data.items); }); }, []);
  useEffect(() => { if (me) load(); }, [me, load]);

  if (me === undefined) return <p className="text-sm text-muted">{t("Loading…")}</p>;
  if (!me) return (
    <div className="card p-6">
      <p className="text-muted">{t("Sign in to suggest an edit. Every edit needs a source, and an editor reads it before it is published.")}</p>
      <p className="mt-3"><Link href="/account" className="chip !border-gold/40 hover:!text-gold">{t("Sign in or create an account")}</Link></p>
    </div>
  );

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim();
    setBusy(true); setMsg(null);
    const r = await api("/api/contribute", "POST", { boxerSlug: v("boxer"), role: v("role"), personName: v("person"), start: v("start"), end: v("end") || null, sourceUrl: v("url"), quote: v("quote"), note: v("note") });
    setBusy(false);
    if (!r.ok) { setMsg({ text: explain(t, r.data.error), bad: true }); return; }
    setMsg({ text: t("Thank you. An editor will check the source before this is published."), bad: false });
    setFormKey((k) => k + 1); load();
  }
  async function withdraw(id: number) { await api("/api/contribute", "DELETE", { id }); load(); }

  return (
    <div className="space-y-8">
      <form key={formKey} onSubmit={submit} className="card grid gap-4 p-5 md:grid-cols-2" aria-label={t("Suggest an edit")}>
        <div className="md:col-span-2">
          <span className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Fighter")}</span>
          <FighterPicker name="boxer" label="" placeholder={t("Search for a fighter…")} initial={initial} />
        </div>
        <div>
          <label htmlFor="c-role" className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Role")}</label>
          <select id="c-role" name="role" required defaultValue="head_trainer" className={input}>{ROLES.map(([k]) => <option key={k} value={k}>{roleLabel[k]}</option>)}</select>
        </div>
        <div>
          <label htmlFor="c-person" className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Person")}</label>
          <input id="c-person" name="person" required minLength={2} maxLength={80} className={input} autoComplete="off" placeholder={t("Full name")} />
        </div>
        <div>
          <label htmlFor="c-start" className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("From")}</label>
          <input id="c-start" name="start" type="date" required className={input} />
        </div>
        <div>
          <label htmlFor="c-end" className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Until (leave empty if still working together)")}</label>
          <input id="c-end" name="end" type="date" className={input} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="c-url" className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Source page")}</label>
          <input id="c-url" name="url" type="url" required maxLength={500} className={input} placeholder="https://" inputMode="url" />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="c-quote" className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("The words on that page that say it")}</label>
          <textarea id="c-quote" name="quote" required minLength={12} maxLength={300} rows={3} className={input} aria-describedby="c-quote-hint" />
          <p id="c-quote-hint" className="mt-1 text-xs text-muted">{t("Copy them exactly, up to 300 characters. Editors check that they are really on the page.")}</p>
        </div>
        <div className="md:col-span-2">
          <label htmlFor="c-note" className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Anything else the editor should know (optional)")}</label>
          <textarea id="c-note" name="note" maxLength={500} rows={2} className={input} />
        </div>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <button className="rounded-xl bg-red-btn px-5 py-2.5 font-display text-lg font-bold uppercase text-white transition hover:brightness-90 disabled:opacity-60" disabled={busy}>{t("Send for review")}</button>
          <span role="status" aria-live="polite" className={`text-sm ${msg?.bad ? "text-red-ink" : "text-win"}`}>{msg?.text}</span>
        </div>
      </form>

      <section aria-labelledby="my-edits">
        <h2 id="my-edits" className="mb-3 font-display text-3xl font-bold uppercase">{t("Your suggestions")}</h2>
        {mineList === null ? <p className="text-sm text-muted">{t("Loading…")}</p> : mineList.length === 0 ? <p className="text-sm text-muted">{t("You have not suggested anything yet.")}</p> : (
          <ul className="space-y-2">
            {mineList.map((c) => (
              <li key={c.id} className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  <span className="block font-semibold">{c.personName} · {roleLabel[c.role] ?? c.role}</span>
                  <span className="block text-xs text-muted">{c.boxerSlug ? <Link href={`/boxers/${c.boxerSlug}`} className="underline decoration-dotted hover:text-ink">{c.boxerName}</Link> : c.boxerName} · {c.start} → {c.end ?? t("now")}</span>
                  {c.reviewNote && <span className="mt-1 block text-xs text-muted">{t("Editor’s note: {note}", { note: c.reviewNote })}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className={`chip ${c.status === "approved" ? "!border-win/50 !text-win" : c.status === "rejected" ? "!border-red/50 !text-red-ink" : ""}`}>{statusLabel[c.status] ?? c.status}</span>
                  {c.status === "pending" && <button className="text-xs underline decoration-dotted hover:text-ink" onClick={() => void withdraw(c.id)}>{t("Withdraw")}</button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

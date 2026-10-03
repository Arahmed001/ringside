"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "@/components/L";
import { useT } from "@/components/i18n";
import { api, useAccount } from "@/lib/useAccount";
import { explain } from "@/lib/account-text";
import type { ContributionView } from "@/lib/accounts/contributions";

type Tab = "pending" | "approved" | "rejected";

/** The editor's queue: read the source, have the quote checked on the live page, approve or reject with a reason. */
export function ReviewQueue() {
  const t = useT();
  const me = useAccount();
  const [tab, setTab] = useState<Tab>("pending");
  const [loaded, setLoaded] = useState<{ tab: Tab; items: ContributionView[] } | null>(null);
  const items = loaded?.tab === tab ? loaded.items : null; // null while the tab being shown is still loading
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const role: Record<string, string> = { head_trainer: t("Head trainer"), assistant_trainer: t("Assistant trainer"), strength_coach: t("Strength"), cutman: t("Cutman"), manager: t("Manager") };
  const flag: Record<string, string> = {
    quote_lacks_name: t("The quote does not contain the person’s name."), overlaps_other: t("Overlaps someone already listed in this role."),
    before_career: t("Starts long before the fighter’s first fight on record."), new_person: t("This person is not in the data yet (a new page will be created)."),
  };
  const check: Record<string, string> = {
    quote_found: t("Checked by code: the quote is on the page."), quote_missing: t("Checked by code: the quote is NOT on the page."),
    unreadable: t("Checked by code: the page could not be read (blocked, gone or not text)."), unavailable: t("The source check is not set up on this server."),
  };

  const load = useCallback((which: Tab) => { void api<{ items: ContributionView[] }>(`/api/review?status=${which}`, "GET").then((r) => { if (r.ok) setLoaded({ tab: which, items: r.data.items }); else { setLoaded({ tab: which, items: [] }); setMsg(explain(t, r.data.error)); } }); }, [t]);
  useEffect(() => { if (me && (me.role === "editor" || me.role === "admin")) load(tab); }, [me, tab, load]);

  if (me === undefined) return <p className="text-sm text-muted">{t("Loading…")}</p>;
  if (!me || (me.role !== "editor" && me.role !== "admin")) return <div className="card p-6"><p className="text-muted">{me ? t("Only editors can review edits.") : t("Sign in as an editor to review edits.")}</p>{!me && <p className="mt-3"><Link href="/account" className="chip hover:!text-gold">{t("Sign in")}</Link></p>}</div>;

  async function decide(id: number, decision: "approved" | "rejected", note: string) {
    setBusy(id); setMsg("");
    const r = await api(`/api/review/${id}`, "POST", { decision, note });
    setBusy(null);
    if (!r.ok) { setMsg(explain(t, r.data.error)); return; }
    setMsg(decision === "approved" ? t("Approved and published.") : t("Rejected."));
    load(tab);
  }
  async function runCheck(id: number) {
    setBusy(id); setMsg("");
    const r = await api<{ result: string }>(`/api/review/${id}/check`, "POST", {});
    setBusy(null);
    if (!r.ok) { setMsg(explain(t, r.data.error)); return; }
    load(tab);
  }
  const tabs: [Tab, string][] = [["pending", t("Waiting")], ["approved", t("Approved")], ["rejected", t("Not accepted")]];
  return (
    <div className="space-y-5">
      <div role="tablist" aria-label={t("Review queue")} className="flex flex-wrap gap-2">
        {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-full border px-3 py-1 text-sm ${tab === k ? "border-gold/60 text-ink" : "border-line text-muted hover:text-ink"}`}>{label}</button>)}
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted">{msg}</p>
      {items === null ? <p className="text-sm text-muted">{t("Loading…")}</p> : items.length === 0 ? <p className="text-sm text-muted">{tab === "pending" ? t("Nothing is waiting.") : t("Nothing here yet.")}</p> : (
        <ul className="space-y-4">
          {items.map((c) => <Item key={c.id} c={c} tab={tab} busy={busy === c.id} role={role} flag={flag} check={check} decide={decide} runCheck={runCheck} />)}
        </ul>
      )}
    </div>
  );
}

function Item({ c, tab, busy, role, flag, check, decide, runCheck }: { c: ContributionView; tab: Tab; busy: boolean; role: Record<string, string>; flag: Record<string, string>; check: Record<string, string>; decide: (id: number, d: "approved" | "rejected", note: string) => void; runCheck: (id: number) => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  return (
    <li className="card space-y-3 p-5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-2xl font-bold">{c.personName} <span className="chip align-middle">{role[c.role] ?? c.role}</span></div>
          <div className="text-muted">{c.boxerSlug ? <Link href={`/boxers/${c.boxerSlug}`} className="underline decoration-dotted hover:text-ink">{c.boxerName}</Link> : c.boxerName} · {c.start} → {c.end ?? t("now")}</div>
        </div>
        <div className="text-end text-xs text-muted"><div>{t("Proposed by {name}", { name: c.proposer ?? t("a deleted account") })}</div><div>{c.createdAt.slice(0, 10)}</div></div>
      </div>
      <blockquote className="border-s-2 border-gold/50 ps-3 text-ink/90">“{c.quote}”</blockquote>
      <p>{/^https?:\/\//.test(c.sourceUrl) ? <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer nofollow ugc" className="break-all underline decoration-dotted hover:text-gold">{c.sourceUrl}</a> : <span className="break-all">{c.sourceUrl}</span>}</p>
      {c.note && <p className="text-muted">{t("Proposer’s note: {note}", { note: c.note })}</p>}
      {c.flags.length > 0 && <ul className="list-disc space-y-0.5 ps-5 text-gold">{c.flags.map((f) => <li key={f}>{flag[f] ?? f}</li>)}</ul>}
      {c.sourceCheck && <p className={c.sourceCheck === "quote_found" ? "text-win" : "text-red-ink"}>{check[c.sourceCheck] ?? c.sourceCheck}</p>}
      {tab === "pending" ? (
        <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <button className="rounded-xl border border-line bg-panel2 px-4 py-2 transition hover:border-white/30 disabled:opacity-60" disabled={busy} onClick={() => runCheck(c.id)}>{t("Check the quote on the page")}</button>
          <div className="min-w-[12rem] flex-1">
            <label htmlFor={`note-${c.id}`} className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Note (needed to reject)")}</label>
            <input id={`note-${c.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="w-full rounded-xl border border-line bg-panel2 px-3 py-2 outline-none focus:border-gold/60" />
          </div>
          <button className="rounded-xl bg-red-btn px-4 py-2 font-bold text-white hover:brightness-90 disabled:opacity-60" disabled={busy} onClick={() => decide(c.id, "approved", note)}>{t("Approve")}</button>
          <button className="rounded-xl border border-line bg-panel2 px-4 py-2 transition hover:border-red/60 disabled:opacity-60" disabled={busy} onClick={() => decide(c.id, "rejected", note)}>{t("Reject")}</button>
        </div>
      ) : (
        <p className="border-t border-line pt-3 text-xs text-muted">{t("Decided by {name} on {date}", { name: c.reviewedBy ?? "?", date: (c.reviewedAt ?? "").slice(0, 10) })}{c.reviewNote ? ` · ${c.reviewNote}` : ""}</p>
      )}
    </li>
  );
}

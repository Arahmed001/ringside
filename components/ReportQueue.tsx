"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "@/components/L";
import { useT } from "@/components/i18n";
import { api, useAccount } from "@/lib/useAccount";
import { explain } from "@/lib/account-text";
import { fieldLabel, namesOf, statusLabel, valueText } from "@/lib/correction-text";
import type { ReportView } from "@/lib/accounts/corrections";

type Tab = "error" | "flagged" | "owner" | "about_me";
type Status = "open" | "accepted" | "rejected" | "noted";

/**
 * Editors' queue for reports of a wrong fact. A correction can only be accepted when the page it cites is published by the owner of that kind of fact (a
 * commission or sanctioning body for a fight; the fighter's own page for their details): where it is not, the only options are to reject or to note it, and what
 * the data feed says stands.
 */
export function ReportQueue() {
  const t = useT();
  const me = useAccount();
  const [tab, setTab] = useState<Tab>("error");
  const [status, setStatus] = useState<Status>("open");
  const [loaded, setLoaded] = useState<{ key: string; items: ReportView[] } | null>(null);
  const key = `${tab}:${status}`;
  const items = loaded?.key === key ? loaded.items : null;
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const isReviewer = me?.role === "editor" || me?.role === "admin";
  const check: Record<string, string> = {
    quote_found: t("Checked by code: the quote is on the page."), quote_missing: t("Checked by code: the quote is NOT on the page."),
    unreadable: t("Checked by code: the page could not be read (blocked, gone or not text)."), unavailable: t("The source check is not set up on this server."),
  };

  const load = useCallback((tb: Tab, st: Status) => {
    void api<{ items: ReportView[] }>(`/api/review/reports?kind=${tb}&status=${st}`, "GET").then((r) => {
      if (r.ok) setLoaded({ key: `${tb}:${st}`, items: r.data.items }); else { setLoaded({ key: `${tb}:${st}`, items: [] }); setMsg(explain(t, r.data.error)); }
    });
  }, [t]);
  useEffect(() => { if (isReviewer) load(tab, status); }, [isReviewer, tab, status, load]);

  if (me === undefined) return <p className="text-sm text-muted">{t("Loading…")}</p>;
  if (!me || !isReviewer) return <div className="card p-6"><p className="text-muted">{me ? t("Only editors can review reports.") : t("Sign in as an editor to review reports.")}</p>{!me && <p className="mt-3"><Link href="/account" className="chip hover:!text-gold">{t("Sign in")}</Link></p>}</div>;

  async function act(id: number, body: Record<string, string>, done: string) {
    setBusy(id); setMsg("");
    const r = await api(`/api/review/reports/${id}`, "POST", body);
    setBusy(null);
    if (!r.ok) { setMsg(explain(t, r.data.error)); return; }
    setMsg(done); load(tab, status);
  }
  async function runCheck(id: number) {
    setBusy(id); setMsg("");
    const r = await api(`/api/review/reports/${id}/check`, "POST", {});
    setBusy(null);
    if (!r.ok) { setMsg(explain(t, r.data.error)); return; }
    load(tab, status);
  }

  const tabs: [Tab, string][] = [["error", t("Corrections")], ["flagged", t("Look again")], ["owner", t("Fighters’ own changes")], ...(me.role === "admin" ? [["about_me", t("About me")] as [Tab, string]] : [])];
  const statuses: [Status, string][] = [["open", t("Waiting")], ["accepted", t("Accepted")], ["rejected", t("Not accepted")], ["noted", t("Noted")]];
  const empty = tab === "flagged" ? t("Nothing needs a second look.") : tab === "owner" ? t("No fighter has changed their own details yet.") : status === "open" ? t("Nothing is waiting.") : t("Nothing here yet.");
  return (
    <div className="space-y-5">
      <div role="tablist" aria-label={t("Reports")} className="flex flex-wrap gap-2">
        {tabs.map(([k, text]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setStatus("open"); setMsg(""); }} className={`rounded-full border px-3 py-1 text-sm ${tab === k ? "border-gold/60 text-ink" : "border-line text-muted hover:text-ink"}`}>{text}</button>)}
      </div>
      {(tab === "error" || tab === "about_me") && (
        <div role="group" aria-label={t("Show")} className="flex flex-wrap gap-2 text-xs">
          {statuses.filter(([k]) => tab === "error" || k !== "noted").map(([k, text]) => <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)} className={`rounded-full border px-2.5 py-0.5 ${status === k ? "border-gold/60 text-ink" : "border-line text-muted hover:text-ink"}`}>{text}</button>)}
        </div>
      )}
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted">{msg}</p>
      {items === null ? <p className="text-sm text-muted">{t("Loading…")}</p> : items.length === 0 ? <p className="text-sm text-muted">{empty}</p> : (
        <ul className="space-y-4">
          {items.map((r) => <Item key={r.id} r={r} tab={tab} busy={busy === r.id} check={check} act={act} runCheck={runCheck} />)}
        </ul>
      )}
    </div>
  );
}

function Item({ r, tab, busy, check, act, runCheck }: { r: ReportView; tab: Tab; busy: boolean; check: Record<string, string>; act: (id: number, body: Record<string, string>, done: string) => void; runCheck: (id: number) => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  const names = namesOf(r.targetName);
  const val = (v: string | null) => valueText(t, r.field, v, names);
  const open = r.status === "open";
  const correction = r.kind === "error" && r.field && r.field !== "other";
  const ownerSource = r.sourceFromOwner;
  const btn = "rounded-xl border border-line bg-panel2 px-4 py-2 transition hover:border-white/30 disabled:opacity-60";
  return (
    <li className="card space-y-3 p-5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-2xl font-bold">
            {r.kind === "about_me" ? t("About me") : fieldLabel(t, r.field)}{" "}
            {r.byOwner && <span className="chip align-middle">{t("By the fighter")}</span>}
          </div>
          <div className="text-muted">{r.targetType === "boxer" && r.targetSlug ? <Link href={`/boxers/${r.targetSlug}`} className="underline decoration-dotted hover:text-ink">{r.targetName}</Link> : r.targetType === "bout" && r.targetName ? <span>{r.targetName}</span> : r.targetName}</div>
        </div>
        <div className="text-end text-xs text-muted"><div>{t("Reported by {name}", { name: r.reporter ?? t("a deleted account") })}</div><div>{r.createdAt.slice(0, 10)}</div></div>
      </div>

      {correction && (
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">{t("The site showed")}</dt><dd>{val(r.shown)}</dd>
          <dt className="text-muted">{t("Should be")}</dt><dd className="font-semibold">{val(r.proposed)}</dd>
          {r.current !== null && r.current !== r.shown && <><dt className="text-muted">{t("Shows now")}</dt><dd>{val(r.current)}</dd></>}
          {tab === "flagged" && <><dt className="text-muted">{t("The feed gave")}</dt><dd>{val(r.originalValue)}</dd><dt className="text-muted">{t("The feed now says")}</dt><dd className="text-gold">{val(r.vendorValue)}</dd></>}
        </dl>
      )}

      {r.quote && <blockquote className="border-s-2 border-gold/50 ps-3 text-ink/90">“{r.quote}”</blockquote>}
      {r.sourceUrl && <p>{/^https?:\/\//.test(r.sourceUrl) ? <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow ugc" className="break-all underline decoration-dotted hover:text-gold">{r.sourceUrl}</a> : <span className="break-all">{r.sourceUrl}</span>}</p>}
      {r.note && <p className="whitespace-pre-line text-muted">{t("Reporter’s note: {note}", { note: r.note })}</p>}
      {r.contact && <p className="text-muted">{t("Contact left: {contact}", { contact: r.contact })}</p>}
      {r.kind === "about_me" && open && <p className="text-xs text-muted">{t("To link this account to the fighter, once you have checked who they are, use the owner command on the server (see the accounts guide).")}</p>}

      {open && correction && (ownerSource ? <p className="text-win">{t("The source is published by the owner of this fact.")}</p> : <p className="text-gold">{t("The source is not published by the owner of this fact (a commission or sanctioning body for a fight; the fighter’s own page for their details). It can be noted, but cannot change the data.")}</p>)}
      {r.sourceCheck && <p className={r.sourceCheck === "quote_found" ? "text-win" : "text-red-ink"}>{check[r.sourceCheck] ?? r.sourceCheck}</p>}

      {open ? (
        <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
          {r.sourceUrl && r.quote && <button className={btn} disabled={busy} onClick={() => runCheck(r.id)}>{t("Check the quote on the page")}</button>}
          <div className="min-w-[12rem] flex-1">
            <label htmlFor={`rn-${r.id}`} className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Note (needed to reject or note)")}</label>
            <input id={`rn-${r.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="w-full rounded-xl border border-line bg-panel2 px-3 py-2 outline-none focus:border-gold/60" />
          </div>
          {(r.kind === "about_me" || !correction || ownerSource) && <button className="rounded-xl bg-red-btn px-4 py-2 font-bold text-white hover:brightness-90 disabled:opacity-60" disabled={busy} onClick={() => act(r.id, { decision: "accepted", note }, r.kind === "about_me" ? t("Marked as handled.") : t("Accepted."))}>{r.kind === "about_me" ? t("Handled") : t("Accept")}</button>}
          {correction && !ownerSource && <button className={btn} disabled={busy} onClick={() => act(r.id, { decision: "noted", note }, t("Noted. The data is unchanged."))}>{t("Note it")}</button>}
          <button className={`${btn} hover:!border-red/60`} disabled={busy} onClick={() => act(r.id, { decision: "rejected", note }, t("Rejected."))}>{t("Reject")}</button>
        </div>
      ) : tab === "flagged" || tab === "owner" ? (
        <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor={`rn-${r.id}`} className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Note (needed)")}</label>
            <input id={`rn-${r.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="w-full rounded-xl border border-line bg-panel2 px-3 py-2 outline-none focus:border-gold/60" />
          </div>
          {tab === "flagged" && <button className={btn} disabled={busy} onClick={() => act(r.id, { action: "keep", note }, t("Kept."))}>{t("Keep the correction")}</button>}
          <button className={`${btn} hover:!border-red/60`} disabled={busy} onClick={() => act(r.id, { action: "retire", note }, t("Undone: the feed’s value is back."))}>{tab === "owner" ? t("Undo it") : t("Retire it")}</button>
        </div>
      ) : (
        <p className="border-t border-line pt-3 text-xs text-muted">{statusLabel(t, r.status, r.state)} · {t("Decided by {name} on {date}", { name: r.reviewedBy ?? "?", date: (r.reviewedAt ?? "").slice(0, 10) })}{r.reviewNote ? ` · ${r.reviewNote}` : ""}</p>
      )}
    </li>
  );
}

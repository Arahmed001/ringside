"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "@/components/L";
import { useT } from "@/components/i18n";
import { api, useAccount } from "@/lib/useAccount";

interface Row { id: number; provider: string; url: string; subjectKind: string; subjectExt: string | null; account: string | null; note: string | null; addedAt: string }

/** The editors' list of chosen public posts: add one by its link (checked on the server), see where each shows, and remove one at once. */
export function SocialQueue() {
  const t = useT();
  const me = useAccount();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [form, setForm] = useState({ link: "", subjectKind: "boxer", subjectExt: "", account: "", note: "" });
  const status = useRef<HTMLParagraphElement>(null);
  const isEditor = me?.role === "editor" || me?.role === "admin";
  const explain = (c: unknown) => c === "bad_link" ? t("That is not a link to one public post on YouTube, X, Reddit, Instagram or Facebook.") : c === "bad_subject" ? t("Say which fighter (the last part of the fighter's page address) or which card (its number) the post belongs to.") : c === "duplicate" ? t("That post is already shown there.") : c === "too_many" ? t("That page already shows the most posts it can.") : c === "forbidden" || c === "unauthorized" ? t("Only editors can do that.") : t("Something went wrong. Try again.");
  const load = useCallback(() => { void api<{ posts?: Row[] }>("/api/social", "GET").then((r) => { if (r.ok) setRows(r.data.posts ?? []); else { setRows([]); setMsg({ text: explain(r.data.error), bad: true }); } }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isEditor) load(); }, [isEditor, load]);
  if (me === undefined) return <p className="text-sm text-muted">{t("Loading…")}</p>;
  if (!me || !isEditor) return <div className="card p-6"><p className="text-muted">{me ? t("Only editors can choose posts.") : t("Sign in as an editor to choose posts.")}</p>{!me && <p className="mt-3"><Link href="/account" className="underline decoration-dotted hover:text-ink">{t("Sign in")}</Link></p>}</div>;
  async function add(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const r = await api("/api/social", "POST", { link: form.link, subjectKind: form.subjectKind, subjectExt: form.subjectExt, account: form.account, note: form.note });
    setMsg({ text: r.ok ? t("Added.") : explain(r.data.error), bad: !r.ok });
    if (r.ok) { setForm({ ...form, link: "", note: "" }); load(); }
    status.current?.focus();
  }
  async function remove(id: number) { setMsg(null); const r = await api(`/api/social/${id}/remove`, "POST", {}); setMsg({ text: r.ok ? t("Removed.") : explain(r.data.error), bad: !r.ok }); if (r.ok) load(); status.current?.focus(); }
  const field = "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm";
  return (
    <div className="space-y-6">
      <form onSubmit={add} className="card grid gap-3 p-5 md:grid-cols-2">
        <label className="md:col-span-2 text-sm">{t("Link to the post")}<input value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} required inputMode="url" dir="ltr" className={field} placeholder="https://x.com/…/status/…" /></label>
        <label className="text-sm">{t("Shows on")}
          <select value={form.subjectKind} onChange={(e) => setForm({ ...form, subjectKind: e.target.value })} className={field}>
            <option value="boxer">{t("A fighter's page")}</option><option value="event">{t("A card's page")}</option><option value="general">{t("The news page")}</option>
          </select>
        </label>
        {form.subjectKind !== "general" && <label className="text-sm">{form.subjectKind === "boxer" ? t("Fighter (page address ending)") : t("Card number")}<input value={form.subjectExt} onChange={(e) => setForm({ ...form, subjectExt: e.target.value })} required dir="ltr" className={field} /></label>}
        <label className="text-sm">{t("Account (optional)")}<input value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} className={field} maxLength={60} /></label>
        <label className="text-sm">{t("Note (optional, shown above the post)")}<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={field} maxLength={140} /></label>
        <div className="md:col-span-2"><button type="submit" className="btn min-h-11 cursor-pointer">{t("Add the post")}</button></div>
      </form>
      <p ref={status} tabIndex={-1} role="status" className={`text-sm outline-none ${msg?.bad ? "text-red-ink" : "text-muted"}`}>{msg?.text ?? ""}</p>
      {rows === null ? <p className="text-sm text-muted">{t("Loading…")}</p> : rows.length === 0 ? <p className="text-muted">{t("No posts have been chosen yet.")}</p> : (
        <ul className="space-y-2">{rows.map((r) => (
          <li key={r.id} className="card flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
            <div className="min-w-0"><span lang="en" dir="ltr" className="font-bold">{r.provider}</span> · <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" dir="ltr" className="break-all underline decoration-dotted hover:text-ink">{r.url}</a><div className="text-xs text-muted">{r.subjectKind}{r.subjectExt ? ` · ${r.subjectExt}` : ""}{r.account ? ` · ${r.account}` : ""}</div></div>
            <button type="button" onClick={() => remove(r.id)} className="chip cursor-pointer py-1.5 text-xs hover:!text-ink">{t("Remove")}</button>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

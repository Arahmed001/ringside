"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "@/components/L";
import { useT } from "@/components/i18n";
import { api, useAccount } from "@/lib/useAccount";

interface Row { id: number; slug: string; imageUrl: string; licence: string; credit: string; sourceUrl: string; evidence: string | null; addedAt: string }
const LICENCES = ["CC0", "Public domain", "CC BY", "CC BY-SA", "By permission"];

/** The editors' list of recorded pictures: a picture is added only with the licence (or the permission and its evidence), the credit and the source, and removing a record takes the picture off the page. */
export function PhotoQueue() {
  const t = useT();
  const me = useAccount();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [form, setForm] = useState({ slug: "", imageUrl: "", licence: "By permission", credit: "", sourceUrl: "", evidence: "" });
  const status = useRef<HTMLParagraphElement>(null);
  const isEditor = me?.role === "editor" || me?.role === "admin";
  const explain = (c: unknown) => c === "bad_slug" ? t("The fighter is the last part of the fighter's page address.") : c === "bad_image" ? t("The picture needs an https address that ends in .jpg, .png or .webp.") : c === "no_credit" ? t("Write the credit that goes with the picture.") : c === "bad_source" ? t("The source needs an https address: the page the picture came from.") : c === "no_evidence" ? t("For a picture used by permission, say how you know: who agreed, and when.") : c === "bad_licence" ? t("Choose a licence.") : c === "forbidden" || c === "unauthorized" ? t("Only editors can do that.") : t("Something went wrong. Try again.");
  const load = useCallback(() => { void api<{ images?: Row[] }>("/api/photos", "GET").then((r) => { if (r.ok) setRows(r.data.images ?? []); else { setRows([]); setMsg({ text: explain(r.data.error), bad: true }); } }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isEditor) load(); }, [isEditor, load]);
  if (me === undefined) return <p className="text-sm text-muted">{t("Loading…")}</p>;
  if (!me || !isEditor) return <div className="card p-6"><p className="text-muted">{me ? t("Only editors can record pictures.") : t("Sign in as an editor to record pictures.")}</p>{!me && <p className="mt-3"><Link href="/account" className="underline decoration-dotted hover:text-ink">{t("Sign in")}</Link></p>}</div>;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const r = await api<{ applied?: number; kept?: string[]; unknown?: string[] }>("/api/photos", "POST", form);
    const note = r.ok ? ((r.data.applied ?? 0) > 0 ? t("Saved, and shown on the fighter's page.") : (r.data.kept?.length ? t("Saved, but the fighter already has a photo that came with the data, so it is not replaced.") : t("Saved, but no fighter has that page address yet."))) : explain(r.data.error);
    setMsg({ text: note, bad: !r.ok });
    if (r.ok) { setForm({ ...form, slug: "", imageUrl: "", credit: "", sourceUrl: "", evidence: "" }); load(); }
    status.current?.focus();
  }
  async function remove(id: number) { setMsg(null); const r = await api(`/api/photos/${id}/remove`, "POST", {}); setMsg({ text: r.ok ? t("Removed.") : explain(r.data.error), bad: !r.ok }); if (r.ok) load(); status.current?.focus(); }
  const field = "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm";
  return (
    <div className="space-y-6">
      <form onSubmit={save} className="card grid gap-3 p-5 md:grid-cols-2">
        <label className="text-sm">{t("Fighter (page address ending)")}<input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required dir="ltr" className={field} /></label>
        <label className="text-sm">{t("Licence")}<select value={form.licence} onChange={(e) => setForm({ ...form, licence: e.target.value })} className={field}>{LICENCES.map((l) => <option key={l} value={l}>{l === "By permission" ? t("By permission of the rights-holder") : l}</option>)}</select></label>
        <label className="md:col-span-2 text-sm">{t("Picture address")}<input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} required inputMode="url" dir="ltr" className={field} placeholder="https://…/photo.jpg" /></label>
        <label className="text-sm">{t("Credit (photographer or rights-holder)")}<input value={form.credit} onChange={(e) => setForm({ ...form, credit: e.target.value })} required maxLength={160} className={field} /></label>
        <label className="text-sm">{t("Source page")}<input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} required inputMode="url" dir="ltr" className={field} placeholder="https://…" /></label>
        {form.licence === "By permission" && <label className="md:col-span-2 text-sm">{t("Evidence of the permission (who agreed, how, and when)")}<input value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} required minLength={10} maxLength={300} className={field} /></label>}
        <div className="md:col-span-2"><button type="submit" className="btn min-h-11 cursor-pointer">{t("Save the picture")}</button></div>
      </form>
      <p ref={status} tabIndex={-1} role="status" className={`text-sm outline-none ${msg?.bad ? "text-red-ink" : "text-muted"}`}>{msg?.text ?? ""}</p>
      {rows === null ? <p className="text-sm text-muted">{t("Loading…")}</p> : rows.length === 0 ? <p className="text-muted">{t("No pictures have been recorded yet.")}</p> : (
        <ul className="space-y-2">{rows.map((r) => (
          <li key={r.id} className="card flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
            <div className="min-w-0"><Link href={`/boxers/${r.slug}`} dir="ltr" className="font-bold underline decoration-dotted hover:text-ink">{r.slug}</Link> · {r.licence} · {r.credit}<div className="text-xs text-muted"><a href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" dir="ltr" className="break-all underline decoration-dotted hover:text-ink">{r.sourceUrl}</a>{r.evidence ? ` · ${r.evidence}` : ""}</div></div>
            <button type="button" onClick={() => remove(r.id)} className="chip cursor-pointer py-1.5 text-xs hover:!text-ink">{t("Remove")}</button>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

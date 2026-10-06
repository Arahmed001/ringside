"use client";
import { useState, type FormEvent } from "react";
import Link from "@/components/L";
import { useHref } from "@/components/L";
import { useT } from "@/components/i18n";
import { api, useAccount } from "@/lib/useAccount";
import { forumExplain } from "@/lib/forum/text";
import { checkText, POST_MAX, TITLE_MAX, TITLE_MIN } from "@/lib/forum/rules";

const input = "w-full rounded-xl border border-line bg-panel2 px-3 py-2.5 text-sm outline-none placeholder:text-muted focus:border-gold/60";

/** The form that starts a thread on the general board (round 126). Signed-in people only; the same text rules as a post, checked as you type and again by the server. */
export function StartThread() {
  const t = useT();
  const href = useHref();
  const me = useAccount();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (me === undefined) return null;
  if (!me) return <p className="card p-4 text-sm text-muted">{t("Sign in to start a thread.")} <Link href="/account" className="underline decoration-dotted hover:text-gold">{t("Sign in or create an account")}</Link></p>;

  const tc = title ? checkText(title, { min: TITLE_MIN, max: TITLE_MAX }) : null, bc = body ? checkText(body) : null;
  const titleBad = !!tc && (!!tc.problem || tc.text.includes("\n")), ready = !!tc && !titleBad && !!bc && !bc.problem;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true); setError(null);
    const r = await api<{ threadId: number }>("/api/forum/threads", "POST", { title, body });
    if (r.ok) { window.location.assign(href(`/forum/${r.data.threadId}`)); return; }
    setBusy(false); setError(forumExplain(t, r.data.error));
  }
  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h2 className="eyebrow">{t("Start a thread")}</h2>
      <div><label htmlFor="thread-title" className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Title")}</label>
        <input id="thread-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX + 20} dir="auto" className={input} placeholder={t("What do you want to talk about?")} /></div>
      <div><label htmlFor="thread-body" className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Your first post")}</label>
        <textarea id="thread-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={POST_MAX + 200} dir="auto" className={input} />
        <p className="mt-1 flex justify-between text-xs text-muted"><span>{t("Plain text. No links. Be decent: posts can be reported, and an editor can hide them.")}</span><span className="tabular" aria-hidden>{[...body].length} / {POST_MAX}</span></p></div>
      {titleBad && <p className="text-xs text-red-ink" role="alert">{forumExplain(t, "title_invalid")}</p>}
      {bc?.problem && bc.problem !== "too_short" && <p className="text-xs text-red-ink" role="alert">{forumExplain(t, bc.problem)}</p>}
      <div className="flex items-center gap-3"><button type="submit" disabled={busy || !ready} className="rounded-xl bg-red-btn px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{t("Start the thread")}</button>
        <span role="status" className="text-sm text-red-ink">{error}</span></div>
    </form>
  );
}

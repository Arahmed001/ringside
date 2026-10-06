"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "@/components/L";
import { useLocale, useT } from "@/components/i18n";
import { api } from "@/lib/useAccount";
import { forumExplain } from "@/lib/forum/text";
import { checkText, EDIT_WINDOW_MS, POST_MAX, REPORT_REASONS } from "@/lib/forum/rules";

/**
 * The discussion under a fighter or a fight, or inside a general-board thread (round 126). It is loaded by the browser after the page opens and never written into the
 * page's own HTML, so what people write is not part of a page that search engines index (and the forum's pages are marked not to be indexed). Plain text only, shown as
 * text; the rules are checked as you type, and the server checks them again.
 */
type Role = "user" | "editor" | "admin" | null;
interface Post { id: number; author: string | null; body: string | null; status: "visible" | "hidden" | "deleted"; createdAt: string; editedAt: string | null; mine: boolean; reports?: number }
interface Loaded { thread: { id: number; locked: boolean; postCount: number } | null; posts: Post[]; more: boolean; signedIn: boolean; role: Role }
type Target = { kind: "boxer" | "bout"; subject: string } | { threadId: number };

const input = "w-full rounded-xl border border-line bg-panel2 px-3 py-2.5 text-sm outline-none placeholder:text-muted focus:border-gold/60";
const btn = "chip cursor-pointer py-1.5 transition hover:!text-ink disabled:cursor-not-allowed disabled:opacity-50";

export function Discussion({ target }: { target: Target }) {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; bad: boolean } | null>(null);
  const key = "threadId" in target ? `id=${target.threadId}` : `kind=${target.kind}&subject=${encodeURIComponent(target.subject)}`;

  const fetchPage = useCallback((after = 0) => api<Loaded>(`/api/forum/thread?${key}${after ? `&after=${after}` : ""}`, "GET").then((r) => ({ r, after })), [key]);
  const apply = useCallback(({ r, after }: { r: Awaited<ReturnType<typeof api<Loaded>>>; after: number }) => {
    if (!r.ok) { if (!after) setFailed(true); return; }
    setFailed(false);
    setData((cur) => (after && cur ? { ...r.data, posts: [...cur.posts, ...r.data.posts] } : r.data));
  }, []);
  const load = useCallback(async (after = 0) => apply(await fetchPage(after)), [apply, fetchPage]);
  useEffect(() => { let live = true; void fetchPage().then((x) => { if (live) apply(x); }); return () => { live = false; }; }, [fetchPage, apply]);

  const check = text ? checkText(text) : null;
  const say = (r: { ok: boolean; data: { error?: string } }, okText: string) => setStatus({ text: r.ok ? okText : forumExplain(t, r.data.error), bad: !r.ok });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !check || check.problem) return;
    setBusy(true); setStatus(null);
    const r = await api("/api/forum/post", "POST", { ...target, body: text });
    setBusy(false); say(r, t("Posted."));
    if (r.ok) { setText(""); await load(); }
  }
  async function act(path: string, method: string, body: unknown, okText: string) {
    setStatus(null);
    const r = await api(path, method, body);
    say(r, okText);
    if (r.ok) await load();
    return r.ok;
  }

  if (failed) return <p className="text-sm text-muted">{t("The discussion could not be loaded.")} <button type="button" className="underline decoration-dotted hover:text-ink" onClick={() => void load()}>{t("Try again")}</button></p>;
  if (!data) return <p className="text-sm text-muted">{t("Loading the discussion…")}</p>;
  const editor = data.role === "editor" || data.role === "admin";
  const locked = !!data.thread?.locked;

  return (
    <div className="space-y-4">
      {data.posts.length === 0 && <p className="text-sm text-muted">{t("No one has written here yet.")}</p>}
      <ol className="space-y-3">
        {data.posts.map((p) => <PostItem key={p.id} p={p} editor={editor} signedIn={data.signedIn} locale={locale} act={act} />)}
      </ol>
      {data.more && <button type="button" className={btn} onClick={() => void load(data.posts.at(-1)?.id ?? 0)}>{t("Show more")}</button>}

      {locked ? <p className="text-sm text-muted">{t("This thread is locked.")}</p> : data.signedIn ? (
        <form onSubmit={submit} className="card space-y-2 p-4">
          <label htmlFor="forum-text" className="block text-xs uppercase tracking-widest text-muted">{t("Add to the discussion")}</label>
          <textarea id="forum-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={POST_MAX + 200} dir="auto" className={input}
            placeholder={t("Say something about the fighter or the fight…")} aria-describedby="forum-help" />
          <div id="forum-help" className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>{t("Plain text. No links. Be decent: posts can be reported, and an editor can hide them.")} <Link href="/forum/rules" className="underline decoration-dotted hover:text-ink">{t("Forum rules")}</Link></span>
            <span className="tabular" aria-hidden>{[...text].length} / {POST_MAX}</span>
          </div>
          {check?.problem && check.problem !== "too_short" && <p className="text-xs text-red-ink" role="alert">{forumExplain(t, check.problem)}</p>}
          <div className="flex items-center gap-3"><button type="submit" disabled={busy || !check || !!check.problem} className="rounded-xl bg-red-btn px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{t("Post")}</button>
            <span role="status" className={`text-sm ${status?.bad ? "text-red-ink" : "text-win"}`}>{status?.text}</span></div>
        </form>
      ) : (
        <p className="card p-4 text-sm text-muted">{t("Sign in to join the discussion.")} <Link href="/account" className="underline decoration-dotted hover:text-gold">{t("Sign in or create an account")}</Link></p>
      )}
    </div>
  );
}

function PostItem({ p, editor, signedIn, locale, act }: { p: Post; editor: boolean; signedIn: boolean; locale: string; act: (path: string, method: string, body: unknown, okText: string) => Promise<boolean> }) {
  const t = useT();
  const [mode, setMode] = useState<"view" | "edit" | "report" | "delete">("view");
  const [draft, setDraft] = useState(p.body ?? "");
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [note, setNote] = useState("");
  const when = new Date(p.createdAt);
  const [now] = useState(() => Date.now()); // when the page was opened: an edit button is offered while the quarter hour lasts
  const stamp = when.toLocaleString(locale === "ar" ? "ar-u-nu-latn" : "en", { dateStyle: "medium", timeStyle: "short" });
  const canEdit = p.mine && p.status === "visible" && now - when.getTime() < EDIT_WINDOW_MS;
  const reasonLabel = (r: string) => r === "spam" ? t("Spam") : r === "abuse" ? t("Abuse or harassment") : r === "off_topic" ? t("Off topic") : t("Something else");

  return (
    <li className="card p-4" id={`post-${p.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted">
        <span>{p.status === "visible" ? <b className="text-ink">{p.author ?? t("deleted account")}</b> : null}{p.mine && p.status === "visible" ? <span> · {t("you")}</span> : null}</span>
        <span><time dateTime={p.createdAt}>{stamp}</time>{p.editedAt ? ` · ${t("edited")}` : ""}</span>
      </div>
      {p.status === "visible" ? (
        mode === "edit" ? (
          <form className="mt-2 space-y-2" onSubmit={async (e) => { e.preventDefault(); if (await act(`/api/forum/posts/${p.id}`, "PATCH", { body: draft }, t("Saved."))) setMode("view"); }}>
            <label htmlFor={`edit-${p.id}`} className="sr-only">{t("Edit your post")}</label>
            <textarea id={`edit-${p.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} dir="auto" className={input} />
            <div className="flex gap-2"><button type="submit" className={btn}>{t("Save")}</button><button type="button" className={btn} onClick={() => setMode("view")}>{t("Cancel")}</button></div>
          </form>
        ) : <p className="mt-2 whitespace-pre-wrap break-words text-sm" dir="auto">{p.body}</p>
      ) : (
        <p className="mt-2 text-sm italic text-muted">{p.status === "deleted" ? t("This post was deleted.") : t("This post was hidden.")}</p>
      )}
      {editor && typeof p.reports === "number" && p.reports > 0 && <p className="mt-2 text-xs text-gold">{t("{n} open reports", { n: p.reports })}</p>}
      {mode === "report" && (
        <form className="mt-3 flex flex-wrap items-end gap-2 text-sm" onSubmit={async (e) => { e.preventDefault(); if (await act(`/api/forum/posts/${p.id}/report`, "POST", { reason, note }, t("Reported. Thank you."))) setMode("view"); }}>
          <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Why?")}</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={input}>{REPORT_REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}</select></label>
          <label className="block grow"><span className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("A note (optional)")}</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} dir="auto" className={input} /></label>
          <button type="submit" className={btn}>{t("Send report")}</button><button type="button" className={btn} onClick={() => setMode("view")}>{t("Cancel")}</button>
        </form>
      )}
      {mode === "view" || mode === "delete" ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {canEdit && <button type="button" className={btn} onClick={() => { setDraft(p.body ?? ""); setMode("edit"); }}>{t("Edit")}</button>}
          {p.mine && p.status === "visible" && (mode === "delete"
            ? <><button type="button" className={`${btn} !border-red-ink/50 !text-red-ink`} onClick={async () => { await act(`/api/forum/posts/${p.id}`, "DELETE", undefined, t("Deleted.")); setMode("view"); }}>{t("Yes, delete it")}</button><button type="button" className={btn} onClick={() => setMode("view")}>{t("Cancel")}</button></>
            : <button type="button" className={btn} onClick={() => setMode("delete")}>{t("Delete")}</button>)}
          {signedIn && !p.mine && p.status === "visible" && <button type="button" className={btn} onClick={() => setMode("report")}>{t("Report")}</button>}
          {editor && p.status === "visible" && <button type="button" className={btn} onClick={() => void act(`/api/forum/posts/${p.id}/moderate`, "POST", { action: "hide", reason: "" }, t("Hidden."))}>{t("Hide")}</button>}
          {editor && p.status === "hidden" && <button type="button" className={btn} onClick={() => void act(`/api/forum/posts/${p.id}/moderate`, "POST", { action: "restore" }, t("Restored."))}>{t("Restore")}</button>}
        </div>
      ) : null}
    </li>
  );
}

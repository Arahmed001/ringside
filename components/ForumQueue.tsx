"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "@/components/L";
import { useT } from "@/components/i18n";
import { api, useAccount } from "@/lib/useAccount";
import { forumExplain } from "@/lib/forum/text";

/** The editors' view of the forum (round 127): the posts that people reported, most reported first, and the newest posts of all, with Hide and Restore on each, and the threads that are hidden. */
interface Item { postId: number; threadId: number; body: string; author: string | null; status: string; reports: number; reasons: string[]; createdAt: string; appeal: boolean; withdrawn: boolean; where: { path: string; label: string } }
interface Hidden { id: number; title: string | null; kind: string }
type Tab = "reported" | "recent";

export function ForumQueue() {
  const t = useT();
  const me = useAccount();
  const [tab, setTab] = useState<Tab>("reported");
  const [data, setData] = useState<{ tab: Tab; items: Item[]; hidden: Hidden[] } | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const statusLine = useRef<HTMLParagraphElement>(null);
  const isEditor = me?.role === "editor" || me?.role === "admin";
  const reasonLabel = (r: string) => r === "spam" ? t("Spam") : r === "abuse" ? t("Abuse or harassment") : r === "off_topic" ? t("Off topic") : t("Something else");

  const load = useCallback((tb: Tab) => {
    void api<{ items?: Item[]; posts?: Item[]; hiddenThreads?: Hidden[] }>(tb === "reported" ? "/api/forum/reports" : "/api/forum/recent", "GET").then((r) => {
      if (r.ok) setData({ tab: tb, items: (tb === "reported" ? r.data.items : r.data.posts) ?? [], hidden: r.data.hiddenThreads ?? [] });
      else { setData({ tab: tb, items: [], hidden: [] }); setMsg({ text: forumExplain(t, r.data.error), bad: true }); }
    });
  }, [t]);
  useEffect(() => { if (isEditor) load(tab); }, [isEditor, tab, load]);

  if (me === undefined) return <p className="text-sm text-muted">{t("Loading…")}</p>;
  if (!me || !isEditor) return <div className="card p-6"><p className="text-muted">{me ? t("Only editors can moderate the forum.") : t("Sign in as an editor to moderate the forum.")}</p>{!me && <p className="mt-3"><Link href="/account" className="chip !border-gold/40 hover:!text-gold">{t("Sign in or create an account")}</Link></p>}</div>;

  async function act(path: string, body: unknown, done: string) {
    setMsg(null);
    const r = await api(path, "POST", body);
    setMsg({ text: r.ok ? done : forumExplain(t, r.data.error), bad: !r.ok });
    if (r.ok) load(tab);
    statusLine.current?.focus(); // the button that was pressed is gone with its item: focus goes to the line that says what happened
  }
  const items = data?.tab === tab ? data.items : null;
  const btn = "chip cursor-pointer py-1.5 text-xs transition hover:!text-ink";

  return (
    <div className="space-y-4">
      <div role="group" aria-label={t("What to look at")} className="flex gap-2">
        {([["reported", t("Reported posts and appeals")], ["recent", t("Newest posts")]] as const).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)} className={`chip cursor-pointer ${tab === k ? "!border-gold/50 !text-gold" : ""}`}>{label}</button>
        ))}
      </div>
      <p ref={statusLine} tabIndex={-1} role="status" className={`min-h-5 text-sm outline-none ${msg?.bad ? "text-red-ink" : "text-win"}`}>{msg?.text}</p>
      {items === null ? <p className="text-sm text-muted">{t("Loading…")}</p> : items.length === 0 ? <p className="text-sm text-muted">{tab === "reported" ? t("Nothing is waiting: no post has an open report or an appeal.") : t("No posts yet.")}</p> : (
        <ol className="space-y-3">
          {items.map((i) => (
            <li key={i.postId} className="card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted">
                <span><b className="text-ink">{i.author ?? t("deleted account")}</b> · <Link href={i.where.path} className="underline decoration-dotted hover:text-ink" dir="auto">{i.where.label}</Link></span>
                <span><time dateTime={i.createdAt}>{i.createdAt.slice(0, 16).replace("T", " ")}</time> UTC</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm" dir="auto">{i.body}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {i.reports > 0 && <span className="text-xs text-gold">{t("{n} open reports", { n: i.reports })}: {i.reasons.map(reasonLabel).join(", ")}</span>}
                {i.appeal && <span className="chip !border-gold/50 !text-gold">{t("appeal: the author asks for a review")}</span>}
                {i.status === "hidden" && <span className="chip !text-red-ink">{t("hidden")}</span>}
                {i.withdrawn && <span className="chip">{t("withdrawn by the author; the words are kept for editors for a while")}</span>}
                {i.status === "visible" && <button type="button" className={btn} onClick={() => void act(`/api/forum/posts/${i.postId}/moderate`, { action: "hide", reason: "" }, t("Hidden."))}>{t("Hide")}</button>}
                {(i.status === "hidden" || i.reports > 0) && <button type="button" className={btn} onClick={() => void act(`/api/forum/posts/${i.postId}/moderate`, { action: "restore" }, t("Restored."))}>{i.status === "hidden" ? t("Restore") : t("Dismiss the reports")}</button>}
                {i.appeal && <button type="button" className={btn} onClick={() => void act(`/api/forum/posts/${i.postId}/moderate`, { action: "confirm", reason: "" }, t("Kept hidden."))}>{t("Keep hidden")}</button>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {tab === "recent" && data?.hidden && data.hidden.length > 0 && (
        <section><h2 className="eyebrow mb-2">{t("Hidden threads")}</h2>
          <ul className="card divide-y divide-line/60">{data.hidden.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 p-3 text-sm"><span dir="auto">{h.title ?? `#${h.id}`}</span>
              <button type="button" className={btn} onClick={() => void act(`/api/forum/threads/${h.id}/moderate`, { action: "show" }, t("Shown again."))}>{t("Show again")}</button></li>))}</ul></section>
      )}
    </div>
  );
}

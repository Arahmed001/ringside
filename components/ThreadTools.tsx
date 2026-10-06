"use client";
import { useState } from "react";
import { useT } from "@/components/i18n";
import { api, useAccount } from "@/lib/useAccount";
import { forumExplain } from "@/lib/forum/text";

/** Lock, unlock or hide a thread: shown to editors and admins only, on the thread's page (round 127). The page reloads after, so the thread shows what it now is. */
export function ThreadTools({ id, locked }: { id: number; locked: boolean }) {
  const t = useT();
  const me = useAccount();
  const [err, setErr] = useState<string | null>(null);
  if (me?.role !== "editor" && me?.role !== "admin") return null;
  async function go(action: "lock" | "unlock" | "hide") {
    setErr(null);
    const r = await api(`/api/forum/threads/${id}/moderate`, "POST", { action });
    if (r.ok) window.location.assign(action === "hide" ? window.location.pathname.replace(/\/forum\/\d+$/, "/forum") : window.location.pathname); else setErr(forumExplain(t, r.data.error));
  }
  const btn = "chip cursor-pointer py-1.5 text-xs transition hover:!text-ink";
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("Editor tools")}>
      <button type="button" className={btn} onClick={() => void go(locked ? "unlock" : "lock")}>{locked ? t("Unlock the thread") : t("Lock the thread")}</button>
      <button type="button" className={btn} onClick={() => void go("hide")}>{t("Hide the thread")}</button>
      <span role="status" className="text-xs text-red-ink">{err}</span>
    </div>
  );
}

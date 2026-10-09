"use client";
import { useEffect, useState } from "react";
import Link from "@/components/L";
import { useT } from "@/components/i18n";
import { api, useAccount } from "@/lib/useAccount";

interface Summary { teamEdits: number; reports: number; forum: number; updates: number; posts: number; pictures: number }

/** The editors' pages in one place, each with what waits on it (a number) or what it holds. Shown only to editors and administrators; it asks the server for counts and shows nothing else. */
export function EditorTools() {
  const t = useT();
  const me = useAccount();
  const [s, setS] = useState<Summary | null>(null);
  const isEditor = me?.role === "editor" || me?.role === "admin";
  useEffect(() => { if (isEditor) void api<Summary>("/api/review/summary", "GET").then((r) => { if (r.ok) setS(r.data); }); }, [isEditor]);
  if (!isEditor) return null;
  const tools: { href: string; label: string; what: string; n: number | null; waiting: boolean }[] = [
    { href: "/review", label: t("Team-history edits"), what: t("suggested edits to wait for your check"), n: s?.teamEdits ?? null, waiting: true },
    { href: "/review/reports", label: t("Reports of mistakes"), what: t("reports of a wrong value"), n: s?.reports ?? null, waiting: true },
    { href: "/review/forum", label: t("Forum moderation"), what: t("forum posts that people reported"), n: s?.forum ?? null, waiting: true },
    { href: "/review/updates", label: t("Updates from public sources"), what: t("proposed changes waiting for an administrator"), n: s?.updates ?? null, waiting: true },
    { href: "/review/social", label: t("Chosen posts"), what: t("posts chosen to show"), n: s?.posts ?? null, waiting: false },
    { href: "/review/photos", label: t("Recorded pictures"), what: t("pictures recorded with their licence"), n: s?.pictures ?? null, waiting: false },
  ];
  return (
    <nav aria-label={t("The editors' pages")} className="space-y-3">
      <h2 className="font-display text-2xl font-bold uppercase">{t("The editors' pages")}</h2>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tools.map((x) => (
          <li key={x.href}>
            <Link href={x.href} className="card card-hover flex items-center justify-between gap-3 p-4">
              <span className="min-w-0"><span className="block font-bold">{x.label}</span><span className="block text-xs text-muted">{x.what}</span></span>
              {x.n !== null && <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${x.waiting && x.n > 0 ? "bg-gold/20 text-gold" : "bg-panel-2 text-muted"}`} aria-label={`${x.n}`}>{x.n}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

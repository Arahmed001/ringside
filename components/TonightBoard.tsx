"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { TonightBout } from "@/lib/tonight";
import { usePicks } from "@/lib/usePicks";
import { useT } from "@/components/i18n";
import Link from "@/components/L";

const EVERY_MS = 60_000;

/** Today's card, fight by fight. Your pick and the model's chance are shown beside each result; while fights are undecided the page asks the server for new results every minute. */
export function TonightBoard({ bouts }: { bouts: TonightBout[] }) {
  const t = useT();
  const router = useRouter();
  const { picks } = usePicks();
  const open = bouts.filter((b) => b.status === "pending").length;
  const done = bouts.filter((b) => b.status === "decided").length;
  const total = bouts.filter((b) => b.status !== "cancelled").length;
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, EVERY_MS);
    return () => clearInterval(id);
  }, [open, router]);
  const roles = { main: t("Main event"), co: t("Co-main"), under: t("Undercard") };
  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="text-sm text-muted tabular">{t("{done} of {total} fights decided", { done, total })}</p>
      <ul className="space-y-3">
        {bouts.map((b) => {
          const mine = picks[b.id];
          const side = (f: TonightBout["red"], blue: boolean) => {
            const won = b.winnerId === f.id;
            return (
              <div className={`min-w-0 ${blue ? "text-end" : ""}`}>
                <Link href={`/boxers/${f.slug}`} className={`inline-block py-0.5 font-display text-lg font-bold leading-tight hover:text-gold [:lang(ar)_&]:text-base ${won ? "text-win" : ""}`}>{won && "✓ "}{f.name}</Link>
                <div className="text-xs text-muted tabular">{f.record} · {f.rating}</div>
                <div className="mt-1 font-display text-2xl font-bold text-gold tabular">{f.pct}%</div>
              </div>
            );
          };
          const picked = mine ? (mine === b.red.id ? b.red : mine === b.blue.id ? b.blue : null) : null;
          return (
            <li key={b.id} className={`card p-4 ${b.status === "cancelled" ? "opacity-60" : ""}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span className="uppercase tracking-widest">{b.status === "cancelled" ? t("Cancelled") : roles[b.role]} · {b.division} · {t.n(b.rounds, "{n} rd", "{n} rds")}</span>
                {b.title && <span className="chip !border-gold/40 !text-gold">{b.title}</span>}
              </div>
              <div className="ltr-fixed grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
                {side(b.red, false)}
                <Link href={`/bouts/${b.id}`} className="py-1 text-center" title={t("Full bout details")}>
                  <div className="font-display text-xl font-bold text-gold">{t("VS")}</div>
                  <div className="text-xs text-muted">{b.status === "decided" ? b.how : b.status === "pending" ? t("To come") : ""}</div>
                </Link>
                {side(b.blue, true)}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3 text-xs text-muted">
                <span>{t("Win chance")}{b.pDraw > 0 ? <> · {t("Draw")} <bdi dir="ltr">{b.pDraw}%</bdi></> : null}</span>
                {b.status !== "cancelled" && (
                  <span>
                    {picked ? <>{t("Your pick")}: <b className="text-ink">{picked.name}</b></> : t("No pick made")}
                    {picked && b.status === "decided" && (b.winnerId === picked.id ? <b className="ms-2 text-win">{t("You called it")}</b> : <b className="ms-2 text-red-ink">{t("Missed")}</b>)}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">
        <Link href="/picks" className="inline-block py-1 text-ink underline decoration-dotted hover:text-gold">{t("See how your picks did")}</Link>
      </p>
    </div>
  );
}

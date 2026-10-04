"use client";
import { useRef, useState } from "react";
import { useT } from "@/components/i18n";

/**
 * Shares the page you are on: the phone's own share sheet where there is one, otherwise the address goes to the clipboard and the button says so. It shares
 * `location.href` as it is, so a matchup or a filtered list shares as exactly what is on screen. Cancelling the sheet is not an error.
 */
export function ShareButton({ title }: { title: string }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (s: "copied" | "failed") => { setState(s); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setState("idle"), 2500); };
  async function share() {
    const url = window.location.href;
    try {
      if (typeof navigator.share === "function") { await navigator.share({ title, url }); return; }
      await navigator.clipboard.writeText(url);
      flash("copied");
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") flash("failed");
    }
  }
  return (
    <button type="button" onClick={share} className="chip cursor-pointer transition hover:text-ink" aria-live="polite">
      {state === "copied" ? t("Link copied") : state === "failed" ? t("Couldn’t copy the link") : t("Share")}
    </button>
  );
}

"use client";
import { useT } from "@/components/i18n";

/** Opens the browser's print window; "save as PDF" is one of its destinations. The page's print layout (white paper, no menus) is in globals.css. */
export function PrintButton() {
  const t = useT();
  return <button type="button" onClick={() => window.print()} className="chip no-print cursor-pointer transition hover:text-ink">{t("Print / save as PDF")}</button>;
}

"use client";
import Link from "@/components/L";
import { useT } from "@/components/i18n";

/** What a visitor sees when a page breaks: no stack, no message, a way to try again, and the reference to quote so the server log line can be found. */
export function ErrorView({ digest, retry }: { digest?: string; retry: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="py-24 text-center">
      <div className="eyebrow mb-2">{t("Error")}</div>
      <h1 className="font-display text-5xl font-extrabold uppercase">{t("Down for the count")}</h1>
      <p className="mx-auto mt-3 max-w-md text-muted">{t("Something broke on our side while building this page. Try again; if it keeps happening, go back to the home page.")}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button onClick={() => retry()} className="rounded-xl bg-red-btn px-6 py-2.5 font-display text-lg font-bold uppercase text-white transition hover:brightness-90">{t("Try again")}</button>
        <Link href="/" className="rounded-xl border border-line bg-panel2 px-6 py-2.5 font-display text-lg font-bold uppercase transition hover:border-white/30">{t("Back to the ring")}</Link>
      </div>
      {digest && <p className="mt-6 text-xs text-muted">{t("Reference: {code}", { code: digest })}</p>}
    </div>
  );
}

"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "@/components/L";
import { usePicks } from "@/lib/usePicks";
import { useLocale, useT } from "@/components/i18n";
import { grade, type PickInfo } from "@/lib/picks-grade";

const MIN_VERSUS = 10; // fewer shared fights than this say more about luck than about who is better

/** Your pick'em record: graded against the results and against the model's pre-fight call. Picks come from your account when signed in, from this browser otherwise. */
export function MyPicks() {
  const t = useT();
  const locale = useLocale();
  const { picks, clearLocal, mode, loading } = usePicks();
  const ids = Object.keys(picks).join(",");
  const [loaded, setLoaded] = useState<{ ids: string; rows: PickInfo[] | null } | null>(null);
  useEffect(() => {
    if (!ids) return;
    const ctl = new AbortController();
    fetch(`/api/picks?ids=${encodeURIComponent(ids)}&lang=${locale}`, { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<PickInfo[]>) : null))
      .then((rows) => setLoaded({ ids, rows }))
      .catch((e) => { if (e?.name !== "AbortError") setLoaded({ ids, rows: null }); });
    return () => ctl.abort();
  }, [ids, locale]);
  const graded = useMemo(() => (loaded?.ids === ids && loaded.rows ? grade(picks, loaded.rows) : null), [loaded, ids, picks]);
  const date = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

  if (loading) return <p className="text-sm text-muted">{t("Loading your picks…")}</p>;
  if (!ids) {
    return (
      <div className="card p-6">
        <p className="text-muted">{t("You have not made any picks yet. Call the card on the home page and your record builds here, fight by fight.")}</p>
        <p className="mt-3"><Link href="/" className="chip !border-gold/40 hover:!text-gold">{t("Call the card")}</Link></p>
      </div>
    );
  }
  if (loaded?.ids !== ids) return <p className="text-sm text-muted">{t("Loading your picks…")}</p>;
  if (!graded) return <p className="text-sm text-muted">{t("Couldn’t load your picks. Try again in a moment.")}</p>;
  const { rows, summary: s } = graded;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div className="space-y-8">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Picks made")} value={String(s.made)} sub={t("{n} still to come", { n: s.pending })} />
        <Stat label={t("Your record")} value={s.graded ? `${s.right}-${s.graded - s.right}` : "–"} sub={s.graded ? t("{p} right", { p: pct(s.accuracy) }) : t("Nothing graded yet")} />
        <Stat label={t("Streak")} value={String(s.streak.current)} sub={t("Best {n}", { n: s.streak.best })} />
        <Stat label={t("The model, same fights")} value={s.model.n ? pct(s.model.accuracy) : "–"} sub={s.model.n ? t("{n} fights it called before the bell", { n: s.model.n }) : t("No prediction on file yet")} />
      </section>

      {s.graded > 0 && (
        <section className="card p-5">
          <div className="eyebrow mb-2">{t("You against the model")}</div>
          {s.versus.n > 0 ? (
            <>
              <p className="text-sm text-ink/90">{t("On the {n} fights you both called: you were right and the model wrong on {a}, the model was right and you wrong on {b}, you were both right on {c} and both wrong on {d}.", { n: s.versus.n, a: s.versus.youOnly, b: s.versus.modelOnly, c: s.versus.both, d: s.versus.neither })}</p>
              {s.versus.n < MIN_VERSUS && <p className="mt-2 text-xs text-muted">{t("Too few fights to say who is better yet (under {n}).", { n: MIN_VERSUS })}</p>}
            </>
          ) : <p className="text-sm text-muted">{t("The model had no prediction on file for these fights, so there is nothing to compare yet.")}</p>}
        </section>
      )}

      <section>
        <h2 className="mb-3 font-display text-3xl font-bold uppercase">{t("Your picks")}</h2>
        <ul className="space-y-2">
          {rows.map((r) => {
            const you = r.pickId === r.info.red.id ? r.info.red.name : r.info.blue.name;
            const model = r.modelPickId === null ? null : r.modelPickId === r.info.red.id ? r.info.red.name : r.info.blue.name;
            const p = r.info.modelPRed === null ? null : Math.max(r.info.modelPRed, 1 - r.info.modelPRed);
            const chip = r.state === "right" ? <span className="chip !border-win/50 !text-win">{t("Right")}</span>
              : r.state === "wrong" ? <span className="chip !border-red/50 !text-red-ink">{t("Wrong")}</span>
              : r.state === "void" ? <span className="chip">{t("No result to grade")}</span>
              : <span className="chip">{r.info.status === "awaiting" ? t("Result not in yet") : t("Still to come")}</span>;
            return (
              <li key={r.info.boutId}>
                <Link href={`/bouts/${r.info.boutId}`} className="card flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition hover:bg-panel2/70">
                  <span>
                    <span className="block font-semibold">{t("{a} vs {b}", { a: r.info.red.name, b: r.info.blue.name })}</span>
                    <span className="block text-xs text-muted">{date(r.info.date)} · {r.info.eventName}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted">{t("You: {name}", { name: you })}</span>
                    {model && p !== null && <span className="text-muted">· {t("Model: {name} {p}", { name: model, p: pct(p) })}</span>}
                    {chip}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {mode === "account" ? (
        <p className="text-xs text-muted">{t("Your picks are saved on your account. Picks lock when fight day begins, so they cannot be changed afterwards.")} <Link href="/leaderboard" className="underline decoration-dotted hover:text-ink">{t("See the leaderboard")}</Link></p>
      ) : (
        <p className="text-xs text-muted">
          {t("Your picks are saved only in this browser; the server sees just the fight numbers when this page loads.")}{" "}
          <Link href="/account" className="underline decoration-dotted hover:text-ink">{t("Sign in to keep them on every device")}</Link>{" · "}
          <button onClick={() => { if (window.confirm(t("Clear all your picks from this browser?"))) clearLocal(); }} className="underline decoration-dotted hover:text-ink">{t("Clear my picks")}</button>
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-widest text-muted">{label}</div>
      <div className="font-display text-4xl font-bold leading-tight tabular">{value}</div>
      <div className="text-xs text-muted">{sub}</div>
    </div>
  );
}

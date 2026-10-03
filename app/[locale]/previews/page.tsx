import { upsetWatch } from "@/lib/upsets";
import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { liveBouts, upcomingEvents } from "@/lib/events";
import { predict } from "@/lib/predict";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { daysUntil, fmtDate } from "@/lib/format";
import { divisionLabel } from "@/lib/divisions";
import { recordStr } from "@/lib/world";
import { Headshot } from "@/components/Portrait";
import { SectionTitle } from "@/components/ui";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/previews", title: t("Fight previews"),
  description: t("Previews for every main event and co-main on the upcoming calendar: what is at stake, the tale of the tape, form, the model's pick and how it expects each fight to end."),
}));

/** Cards covered: the headline fights of the next few shows. */
const CARDS = 8;

export default async function Previews() {
  const t = await getT();
  const w = await getWorld();
  const watch = new Map(upsetWatch(w, t).map((x) => [x.bout.id, x]));
  // a chip only for fights where an upset is a live possibility; coin flips and longshots are on the upset watch page
  const upsetChip = (id: number) => { const x = watch.get(id); return x?.tier === "live" ? <span key="u" className="chip !border-gold/40 !px-2 !py-0 text-xs normal-case tracking-normal !text-gold">{t("Upset watch")} · {Math.round(x.chance * 100)}%</span> : null; };
  const cards = upcomingEvents(w).slice(0, CARDS);
  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">{t("Before the bell")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Fight previews")}</h1>
        <p className="mt-2 max-w-3xl text-muted">{t("The main event and co-main of each upcoming show: what is at stake, the tale of the tape, how each fighter has been doing, the model's pick and how it expects the fight to end. Written from the data; with an API key, Claude writes the article from those same facts.")}</p>
      </div>
      {cards.length === 0 && <p className="card p-6 text-muted">{t("No upcoming cards on the calendar.")}</p>}
      {cards.map((e) => {
        const bouts = liveBouts(w, e.id).filter((b) => b.upcoming).slice(0, 2);
        if (!bouts.length) return null;
        return (
          <section key={e.id}>
            <SectionTitle eyebrow={`${fmtDate(e.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" }, t.locale)} · ${t.name(e.city)}`} title={t.name(e.name)} href={`/events/${e.id}`} cta={t("Full card")} />
            <div className="grid gap-4 md:grid-cols-2">
              {bouts.map((b, i) => {
                const red = w.byId.get(b.redId)!, blue = w.byId.get(b.blueId)!;
                const p = predict(red, blue, t);
                const fav = p.pA >= p.pB ? red : blue;
                return (
                  <Link key={b.id} href={`/previews/${b.id}`} className="card card-hover min-w-0 p-5">
                    <div className="mb-3 flex items-center justify-between gap-2 text-xs uppercase tracking-widest text-muted">
                      <span>{i === 0 ? t("Main event") : t("Co-main")} · {divisionLabel(b.weightClass, red.sex, t)}</span>
                      <span className="flex items-center gap-1.5">{upsetChip(b.id)}{b.title && <span className="chip !border-gold/40 !px-2 !py-0 text-xs !text-gold">{t.name(b.title)}</span>}</span>
                    </div>
                    <div className="ltr-fixed grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
                      {[red, blue].map((f, k) => (
                        <div key={f.id} className={`flex min-w-0 flex-col items-center gap-1 text-center ${k === 1 ? "order-3" : ""}`}>
                          <Headshot boxer={f} size={56} />
                          <div className="w-full truncate font-display text-lg font-bold leading-tight" dir="auto">{t.name(f.name)}</div>
                          <div className="text-xs text-muted tabular">{recordStr(f)}</div>
                        </div>
                      ))}
                      <div className="order-2 font-display text-xl font-extrabold text-gold">{t("VS")}</div>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted">{t("The model favours {name} at {pct}%", { name: t.name(fav.name), pct: Math.round(Math.max(p.pA, p.pB) * 100) })}</span>
                      <span className="shrink-0 text-ink">{t("Read the preview")} <span className="inline-block rtl:rotate-180">→</span></span>
                    </div>
                    <div className="mt-1 text-xs text-muted">{t.n(Math.max(0, daysUntil(e.date)), "In {n} day", "In {n} days")}</div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

import { getT } from "@/lib/i18n/server";
import { getWorld } from "@/lib/world";
import { PrintButton } from "@/components/PrintButton";
import { metaFor } from "@/lib/seo-server";
import { buildTonight } from "@/lib/tonight";
import { fmtDate } from "@/lib/format";
import { TonightBoard } from "@/components/TonightBoard";
import Link from "@/components/L";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/tonight", title: t("Tonight"),
  description: t("Today’s fight card in fight order, with win chances, your picks and the results as they come in."),
}));

export default async function Tonight() {
  const t = await getT();
  const data = buildTonight(await getWorld(), t);
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Fight night")}</div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-5xl font-extrabold uppercase">{t("Tonight")}</h1>
          {data.kind === "card" && <PrintButton />}
        </div>
        {data.kind === "card" && (
          <p className="mt-2 max-w-2xl text-muted">
            <Link href={`/events/${data.event.id}`} className="inline-block py-1 text-ink underline decoration-dotted hover:text-gold">{data.event.name}</Link>
            {" · "}{data.event.venue}, {data.event.city}
          </p>
        )}
      </div>
      {data.kind === "card" ? <TonightBoard bouts={data.bouts} /> : (
        <>
          <div className="card p-6">
            <p className="font-semibold">{t("No fight card tonight.")}</p>
            {data.next ? (
              <p className="mt-2 text-sm text-muted">
                {t("Next card: {event}, {date}.", { event: data.next.event.name, date: fmtDate(data.next.event.date, { weekday: "long", month: "long", day: "numeric" }, t.locale) })}{" "}
                <span className="text-gold">{t.n(data.next.days, "In {n} day", "In {n} days")}</span>
              </p>
            ) : null}
            {data.next && <Link href={`/events/${data.next.event.id}`} className="chip mt-4 !border-gold/60 !text-gold hover:!bg-gold/10">{t("See the next card")}</Link>}
          </div>
          {data.review && (
            <section className="card p-5">
              <div className="eyebrow mb-3">{t("Last card in review")} · {data.review.event.name}</div>
              <p className="font-display text-2xl font-bold leading-snug">{data.review.lines[0]}</p>
              <ul className="mt-4 divide-y divide-line/60 border-t border-line/60 text-sm text-ink/90">{data.review.lines.slice(1).map((l, i) => <li key={i} className="flex gap-3 py-2.5"><span aria-hidden="true" className="mt-[.45rem] size-1.5 shrink-0 rounded-full bg-gold/70" />{l}</li>)}</ul>
              <Link href={`/events/${data.review.event.id}`} className="mt-3 inline-block py-1 text-sm text-muted hover:text-gold">{t("Full card and results")} <span className="inline-block rtl:rotate-180">→</span></Link>
            </section>
          )}
        </>
      )}
      <p className="text-xs text-muted">{(process.env.BOXING_PROVIDER ?? "demo").trim() === "licensed" ? t("Results here are as of the last data update, not a live scoreboard. When a card is on, this page checks for new results every minute.") : t("The fighters and results here are the demo league’s, not a live scoreboard. When a card is on, this page checks for new results every minute.")}</p>
    </div>
  );
}

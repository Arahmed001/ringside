import Link from "@/components/L";
import { Headshot } from "@/components/Portrait";
import { ScrollRegion } from "@/components/ScrollRegion";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";
import { recordStr, type World } from "@/lib/world";
import { fmtDate } from "@/lib/format";
import type { OfficialEntry, OfficialList as List } from "@/lib/official";

const BODY_NAME = { WBA: msg("World Boxing Association"), WBC: msg("World Boxing Council"), IBF: msg("International Boxing Federation"), WBO: msg("World Boxing Organization") } as const;
const BELT = { full: msg("Champion"), regular: msg("Regular champion"), interim: msg("Interim champion") } as const;

/**
 * One sanctioning body's official list for one division, as the data supplier relays it. Not Ringside's ranking and never mixed with it: a fighter we hold links to
 * their page and shows our record and rating; one we do not hold is shown by the name given, with no link and no numbers of ours.
 */
export async function OfficialListView({ list, w }: { list: List; w: World }) {
  const t = await getT();
  const who = (e: OfficialEntry) => {
    const b = e.boxerId !== null ? w.byId.get(e.boxerId) : undefined;
    return { b, name: b ? t.name(b.name) : e.name };
  };
  const date = list.updatedAt ? fmtDate(list.updatedAt.slice(0, 10), { month: "short", day: "numeric", year: "numeric" }, t.locale) : null;
  return (
    <div className="mt-6 space-y-5">
      <div>
        <div className="eyebrow">{t("Official list")}</div>
        <h2 className="font-display text-3xl font-extrabold uppercase">{t(BODY_NAME[list.body])}</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.champions.map((e, i) => {
          const { b, name } = who(e);
          const label = e.titleType ? t(BELT[e.titleType]) : t("Champion");
          const inner = (
            <>
              {b ? <Headshot boxer={b} size={56} /> : <span className="grid h-[70px] w-[56px] place-items-center rounded-xl border border-line text-xs text-muted" aria-hidden="true">?</span>}
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-widest text-gold">{label}</div>
                <div className="font-display text-2xl font-bold leading-tight">{e.vacant || !name ? t("Vacant") : name}</div>
                {b && <div className="text-xs text-muted"><bdi dir="ltr">{recordStr(b)}</bdi></div>}
              </div>
            </>
          );
          return b && !e.vacant
            ? <Link key={i} href={`/boxers/${b.slug}`} className="card card-hover flex items-center gap-3 p-4">{inner}</Link>
            : <div key={i} className="card flex items-center gap-3 p-4">{inner}</div>;
        })}
      </div>
      <ScrollRegion className="card" label={t("{body} contenders", { body: list.body })}>
        {list.contenders.length === 0 ? <p className="p-6 text-sm text-muted">{t("This list has no ranked contenders.")}</p> : (
          <table className="w-full text-sm" aria-label={t("{body} contenders", { body: list.body })}>
            <thead><tr className="text-start text-xs uppercase tracking-widest text-muted"><th className="p-3">#</th><th>{t("Fighter")}</th><th>{t("Record")}</th><th className="p-3 text-end">{t("Elo rating")}</th></tr></thead>
            <tbody>
              {list.contenders.map((e) => {
                const { b, name } = who(e);
                return (
                  <tr key={e.rank ?? name} className="border-t border-line/60">
                    <td className="p-3 font-display text-xl font-bold">{e.rank}</td>
                    <td>
                      {e.vacant || !name ? <span className="text-muted">{t("Vacant")}</span>
                        : b ? <Link href={`/boxers/${b.slug}`} className="flex items-center gap-3 py-2"><Headshot boxer={b} size={36} /><b>{name}</b></Link>
                        : <span className="block py-2 font-semibold">{name}</span>}
                    </td>
                    <td className="tabular">{b ? <bdi dir="ltr">{recordStr(b)}</bdi> : "—"}</td>
                    <td className="p-3 text-end font-semibold tabular">{b ? Math.round(b.rating) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ScrollRegion>
      <p className="max-w-3xl text-xs leading-snug text-muted">
        {date ? t("The {body} list as it stood on {date}.", { body: list.body, date }) : t("The {body} list.", { body: list.body })}{" "}
        {t("These are the body’s own standings, relayed by Boxing Data API from BoxingScene. They are not Ringside’s ranking, and a fighter shown without a link or numbers is not in Ringside’s data yet.")}
      </p>
    </div>
  );
}

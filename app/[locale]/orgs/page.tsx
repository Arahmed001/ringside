import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { orgCard, orgsRanking } from "@/lib/team";
import { Pager, SectionTitle } from "@/components/ui";
import { ListFinder } from "@/components/ListFinder";
import { ORGS_PAGE, pageRows } from "@/lib/people-list";
import { getNames } from "@/lib/i18n/names";
import { msg } from "@/lib/i18n/t";
import { flag } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor, pagedTitle, tabbedTitle, type SearchParams } from "@/lib/seo-server";

export const generateMetadata = ({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) => metaFor(params, (p, t, sp) => ({ path: "/orgs", title: pagedTitle(t, tabbedTitle(t, t("Gyms, promotions & bodies"), KINDS, sp.kind), sp.page), description: t("Boxing gyms, promotions and sanctioning bodies: who trains and signs the fighters, how many events each promotes and which belts they sanction.") }), searchParams);

const KINDS = [["promotion", msg("Promotions")], ["gym", msg("Gyms")]] as const;

export default async function Orgs({ searchParams }: { searchParams: Promise<{ kind?: string; q?: string; page?: string }> }) {
  const t = await getT();
  const sp = await searchParams;
  const kind = sp.kind === "gym" ? "gym" : "promotion";
  const q = (sp.q ?? "").slice(0, 80);
  const w = await getWorld();
  const names = await getNames(t.locale);
  const bodies = [...w.orgs.values()].filter((o) => o.kind === "sanctioning_body");
  const magazines = [...w.orgs.values()].filter((o) => o.kind === "magazine");
  const ranking = orgsRanking(w);
  const common = { q, page: sp.page, names, size: ORGS_PAGE };
  const promos = kind === "promotion" ? pageRows(ranking.promos, (x) => x.o.name, common) : null;
  const gyms = kind === "gym" ? pageRows(ranking.gyms, (x) => x.o.name, common) : null;
  const pg = (promos ?? gyms)!;
  const href = (n: number) => `/orgs?${new URLSearchParams({ kind, ...(q ? { q } : {}), ...(n > 1 ? { page: String(n) } : {}) })}`;
  return (
    <div className="space-y-12">
      <div><div className="eyebrow mb-2">{t("Where fighters train, sign and win belts")}</div><h1 className="font-display text-5xl font-extrabold uppercase">{t("Gyms, promotions & bodies")}</h1></div>
      <section>
        <SectionTitle eyebrow={t("Sanctioning bodies")} title={t("Belts")} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{bodies.map((o) => <Link key={o.id} href={`/orgs/${o.slug}`} className="card card-hover p-4"><div className="font-display text-xl font-bold">{t.name(o.name)}</div></Link>)}</div>
        {magazines.length > 0 && <><p className="mb-3 mt-6 text-xs uppercase tracking-widest text-muted">{t("Magazine belts, not sanctioned by a body")}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{magazines.map((o) => <Link key={o.id} href={`/orgs/${o.slug}`} className="card card-hover p-4"><div className="font-display text-xl font-bold">{t.name(o.name)}</div></Link>)}</div></>}
      </section>
      <section>
        <div className="mb-4 flex flex-wrap gap-2">
          {KINDS.map(([k, label]) => <Link key={k} href={`/orgs?kind=${k}`} aria-current={kind === k ? "page" : undefined} className={`chip ${kind === k ? "!border-gold/50 !text-gold" : ""}`}>{t(label)}</Link>)}
        </div>
        <SectionTitle eyebrow={kind === "promotion" ? t("By events promoted") : t("By current fighters")} title={kind === "promotion" ? t("Promotions") : t("Gyms")} />
        <ListFinder path="/orgs" hidden={{ kind }} q={q} label={kind === "promotion" ? t("Find a promotion by name") : t("Find a gym by name")} total={pg.total} of={pg.of} close={pg.close} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {promos?.shown.map(({ row: { o, events } }) => { const s = orgCard(w, o.id, ["promoter"]); return (
            <Link key={o.id} href={`/orgs/${o.slug}`} className="card card-hover p-4"><div className="font-display text-xl font-bold">{t.name(o.name)}</div><div className="text-xs text-muted">{o.country && flag(o.country)} {t("{events} events · {fighters} fighters signed · {w}-{l} combined", { events, fighters: s.currentFighters, w: s.record.wins, l: s.record.losses })}</div></Link>
          ); })}
          {gyms?.shown.map(({ row: { o } }) => { const s = orgCard(w, o.id, ["gym"]); return (
            <Link key={o.id} href={`/orgs/${o.slug}`} className="card card-hover p-4"><div className="font-display text-xl font-bold">{t.name(o.name)}</div><div className="text-xs text-muted">{o.country && flag(o.country)} {o.city ? t.name(o.city) : ""} · {t("{now} training now · {ever} ever · {pct}% wins", { now: s.currentFighters, ever: s.fighters, pct: Math.round(s.record.winRate * 100) })}</div></Link>
          ); })}
        </div>
        <Pager page={pg.page} pages={pg.pages} href={href} />
      </section>
    </div>
  );
}

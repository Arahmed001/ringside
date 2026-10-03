import { DIVISIONS, slugifyDivision } from "@/lib/divisions";
import { getT } from "@/lib/i18n/server";

/** Sex and division filters as a plain GET form, so it works without JavaScript and every filtered view has its own address. */
export async function RecordsFilter({ sex, division, hidden }: { sex?: string; division?: string; hidden?: Record<string, string> }) {
  const t = await getT();
  const field = "rounded-xl border border-line bg-panel px-3 py-2 text-sm";
  return (
    <form method="get" className="flex flex-wrap items-end gap-3" role="search" aria-label={t("Filter the lists")}>
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="text-xs text-muted">{t("Who")}
        <select name="sex" defaultValue={sex ?? ""} className={`${field} mt-1 block`}>
          <option value="">{t("Everyone")}</option><option value="male">{t("Men")}</option><option value="female">{t("Women")}</option>
        </select>
      </label>
      <label className="text-xs text-muted">{t("Division")}
        <select name="division" defaultValue={division ?? ""} className={`${field} mt-1 block`}>
          <option value="">{t("All divisions")}</option>
          {DIVISIONS.map((d) => <option key={d.name} value={slugifyDivision(d.name)}>{t(d.name)}</option>)}
        </select>
      </label>
      <button className="rounded-xl bg-red-btn px-5 py-2 font-display text-lg font-bold uppercase text-white transition hover:brightness-90">{t("Apply")}</button>
    </form>
  );
}

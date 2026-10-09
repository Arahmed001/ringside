/**
 * npm run map:build [-- path/to/ne_110m_admin_0_countries.geojson]
 * Turns Natural Earth's 1:110m country outlines (public domain, naturalearthdata.com) into `lib/geo/world-110m.json`: one SVG path per country in the Natural Earth projection
 * (`lib/geo/project.ts`), its ISO code, and the box around its main land (an island or an overseas piece does not stretch a country's own map). Run once; the result is committed.
 * Without a path it downloads the file from Natural Earth's GitHub copy.
 */
import fs from "node:fs";
import path from "node:path";
import { HEIGHT, WIDTH, project } from "../lib/geo/project";

type Ring = [number, number][];
type Geom = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
const area = (r: Ring) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + (p[0] * q[1] - q[0] * p[1]); }, 0)) / 2;

async function main() {
  const arg = process.argv[2];
  const geo = JSON.parse(arg ? fs.readFileSync(arg, "utf8") : await (await fetch("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson")).text()) as { features: { properties: Record<string, string>; geometry: Geom }[] };
  const countries: { iso: string; name: string; d: string; box: [number, number, number, number] }[] = [];
  for (const f of geo.features) {
    const p = f.properties, iso = [p.ISO_A2_EH, p.ISO_A2].find((c) => c && /^[A-Z]{2}$/.test(c)) ?? (p.ADM0_A3 === "XKX" || p.NAME === "Kosovo" ? "XK" : "");
    if (!iso || p.ADMIN === "Antarctica") continue;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const projected = polys.map((rings) => rings.map((r) => r.map(([lon, lat]) => project(lat, lon))));
    const d = projected.map((rings) => rings.map((r) => "M" + r.map(([x, y]) => `${x} ${y}`).join("L") + "Z").join("")).join("");
    // the box around the main land: every piece at least a fifth the size of the biggest (so Alaska counts for the United States, the Aleutians and Hawaii do not)
    const sizes = projected.map((rings) => area(rings[0])), big = Math.max(...sizes);
    const main = projected.filter((_, i) => sizes[i] >= big * 0.2).flat(2);
    const xs = main.map((q) => q[0]), ys = main.map((q) => q[1]);
    countries.push({ iso, name: p.NAME || p.ADMIN, d, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((n) => Math.round(n * 10) / 10) as [number, number, number, number] });
  }
  countries.sort((a, b) => (a.iso < b.iso ? -1 : 1));
  const out = path.join(__dirname, "..", "lib", "geo", "world-110m.json");
  fs.writeFileSync(out, JSON.stringify({ width: WIDTH, height: HEIGHT, source: "Natural Earth 1:110m Admin 0 Countries (public domain), Natural Earth projection", countries }));
  console.log(`wrote ${out}: ${countries.length} countries, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });

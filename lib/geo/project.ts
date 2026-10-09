/**
 * The Natural Earth projection (Šavrič, Jenny and Patterson, 2011), the one the world outlines in `world-110m.json` were drawn with, so a venue's latitude and longitude land on the
 * same map as the country shapes. Pure arithmetic: no map library, no tiles, no request to anyone. `project` returns [x, y] in the map's own units: 1,000 across, `HEIGHT` down.
 */
const R = Math.PI / 180;
const raw = (lat: number, lon: number): [number, number] => {
  const p = lat * R, l = lon * R, p2 = p * p, p4 = p2 * p2;
  return [l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))), p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)))];
};
const [xr] = raw(0, 180), [, yr] = raw(90, 0);
/** units across the whole map */
export const WIDTH = 1000;
const K = WIDTH / (2 * xr);
export const HEIGHT = Math.round(2 * yr * K);
export function project(lat: number, lon: number): [number, number] {
  const [x, y] = raw(Math.max(-90, Math.min(90, lat)), Math.max(-180, Math.min(180, lon)));
  return [Math.round((x * K + WIDTH / 2) * 10) / 10, Math.round((HEIGHT / 2 - y * K) * 10) / 10];
}

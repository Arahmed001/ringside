/**
 * The generated poster's colour schemes: [top of the gradient, bottom of it, accent]. Kept apart from the component so a test can
 * check the text contrast on every one of them (the header lines were 2.4:1 on some, measured over every rendered poster in round 19).
 */
export const POSTER_HUES: [string, string, string][] = [
  ["#7a1118", "#1a0507", "#ff5a4d"], ["#10306b", "#050a1a", "#5aa0ff"], ["#6b4a10", "#150f04", "#ffd36a"],
  ["#14583f", "#04120d", "#58e0a8"], ["#4a1a6b", "#0e0415", "#c58bff"], ["#6b2a10", "#150804", "#ff9a5a"],
];

/** Where the header band's dark scrim sits: black at these opacities from y = 0 to HEADER_SCRIM_H (see Poster.tsx). */
export const HEADER_SCRIM = { height: 112, stops: [[0, 0.72], [0.6, 0.55], [1, 0]] as [number, number][] };

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
export const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const scrimAt = (y: number) => {
  const t = Math.min(1, y / HEADER_SCRIM.height), s = HEADER_SCRIM.stops;
  for (let i = 1; i < s.length; i++) if (t <= s[i][0]) return s[i - 1][1] + ((s[i][1] - s[i - 1][1]) * (t - s[i - 1][0])) / (s[i][0] - s[i - 1][0]);
  return 0;
};

/** The poster background (gradient, accent spotlight, header scrim; no fighter art) at the horizontal centre, `y` units from the top of a 400x560 poster. */
export function posterBackground(hue: [string, string, string], y: number): number[] {
  const [c0, c1, accent] = [hex(hue[0]), hex(hue[1]), hex(hue[2])];
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v * (1 - t) + b[i] * t);
  let c = mix(c0, c1, y / 560);
  const d = Math.abs(y - 168) / 336; // the spotlight is an ellipse centred at 50% / 30%, radius 60% of the box
  c = mix(c, accent, d >= 1 ? 0 : 0.5 * (1 - d));
  return mix(c, [0, 0, 0], scrimAt(y));
}

/** Text of `fill` at `opacity` over the background at `y`. */
export function textContrast(hue: [string, string, string], y: number, fill: string, opacity = 1): number {
  const bg = posterBackground(hue, y);
  return contrast(mix3(hex(fill), bg, opacity), bg);
}
const mix3 = (f: number[], bg: number[], a: number) => f.map((v, i) => v * a + bg[i] * (1 - a));

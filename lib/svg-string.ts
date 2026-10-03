import type { ReactNode } from "react";

/**
 * Turns the element tree of a plain SVG component (host elements, fragments, no hooks, no context) into a string.
 * Next refuses `react-dom/server` inside the app, and the generated portrait is nothing but <g>, <path>, <circle> and
 * gradients, so a 30-line serializer is enough. tests/art.test.ts checks it byte for byte against React's own output.
 * Attribute names follow React's: camelCase props become kebab-case, except the few SVG attributes that stay camelCase.
 */
const KEEP = new Set(["viewBox", "preserveAspectRatio", "gradientUnits", "gradientTransform", "clipPathUnits", "patternUnits", "spreadMethod"]);
const attr = (k: string) => (k === "className" ? "class" : KEEP.has(k) ? k : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

interface El { type: unknown; props: Record<string, unknown> }
const isEl = (n: unknown): n is El => typeof n === "object" && n !== null && "type" in n && "props" in n;

export function svgString(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return esc(String(node));
  if (Array.isArray(node)) return node.map(svgString).join("");
  if (!isEl(node)) throw new Error("svgString: unsupported node");
  const { type, props } = node;
  const { children, ...rest } = props;
  if (typeof type === "function") return svgString((type as (p: unknown) => ReactNode)(props));
  if (typeof type !== "string") return svgString(children as ReactNode); // a Fragment
  const attrs = Object.entries(rest)
    .filter(([, v]) => v !== null && v !== undefined && v !== false && typeof v !== "function")
    .map(([k, v]) => {
      if (k === "style") throw new Error("svgString: style objects are not supported");
      return ` ${attr(k)}="${esc(String(v))}"`;
    }).join("");
  const inner = svgString(children as ReactNode);
  return inner ? `<${type}${attrs}>${inner}</${type}>` : `<${type}${attrs}></${type}>`;
}

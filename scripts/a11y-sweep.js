/**
 * The browser sweep: what neither a unit test nor a build can see. Run against a production server in the Browser pane (or any browser's console);
 * see "Re-running the sweep" in docs/accessibility.md. For one page it reports, at the window's current width:
 *   axe-core violations; horizontal overflow, with and without WCAG 1.4.12 text spacing forced on (line height 1.5, letter 0.12em, word 0.16em);
 *   text clipped by an overflow:hidden box (spacing on); text under 11.5 px; SVG chart text under 12 px *as rendered*; sibling boxes of text that overlap.
 * `await __check()` returns "ok <path> w<width>" when all is clean, otherwise the details. Needs axe-core's axe.min.js served next to this file.
 * Why a browser: SVG text scales with its picture, overlapping labels have no markup signature, and only the browser knows what a scroll box contains.
 */
window.__sweep = async () => {
  await new Promise((r) => setTimeout(r, 1200)); // let entrance animations finish: axe reads mid-fade colours otherwise
  if (!window.axe) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "http://localhost:8766/axe.min.js"; s.nonce = document.querySelector("script[nonce]")?.nonce || ""; s.onload = res; s.onerror = () => rej(new Error("blocked")); document.head.appendChild(s); });
  const r = await axe.run(document);
  const doc = document.documentElement;
  const over1 = doc.scrollWidth - doc.clientWidth;
  const st = document.createElement("style");
  st.textContent = "*{line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important} p{margin-bottom:2em !important}";
  document.head.appendChild(st);
  await new Promise((r) => setTimeout(r, 200));
  const over2 = doc.scrollWidth - doc.clientWidth;
  const clipped = [];
  for (const el of document.querySelectorAll("main *")) {
    const cs = getComputedStyle(el);
    if ((cs.overflow === "hidden" || cs.overflowX === "hidden") && !el.classList.contains("truncate") && !el.classList.contains("sr-only") && !el.closest(".truncate") && el.scrollWidth > el.clientWidth + 1 && el.textContent.trim()) clipped.push(el.tagName + "." + String(el.className).slice(0, 30) + ":" + el.textContent.trim().slice(0, 25));
    if (clipped.length > 4) break;
  }
  st.remove();
  const small = [...document.querySelectorAll("main *")].filter((el) => el.children.length === 0 && el.textContent.trim() && parseFloat(getComputedStyle(el).fontSize) < 11.5 && getComputedStyle(el).display !== "none" && el.textContent.trim() !== el.textContent.trim().toUpperCase()).length;
  return `${location.pathname}${location.search} w${innerWidth} h1=${document.querySelectorAll("h1").length} axe=[${r.violations.map((v) => v.id + ":" + v.nodes.length).join(",")}] overflow=${over1} spaced=${over2} clipped=[${clipped.join(" | ")}] tiny=${small}`;
};
// the rendered size of every piece of text inside an SVG chart (font size in the SVG's own units times how much the SVG is scaled); posters are art and are left out
window.__svgText = () => {
  const out = new Map();
  for (const t of document.querySelectorAll("main svg text")) {
    const svg = t.closest("svg");
    if (/^0 0 400 5\d\d$/.test(svg.getAttribute("viewBox") || "")) continue;
    const m = t.getScreenCTM(); if (!m) continue;
    const size = parseFloat(getComputedStyle(t).fontSize) * Math.hypot(m.a, m.b);
    if (size < 11.95) { const k = `${(svg.getAttribute("aria-label") || svg.closest("[aria-label]")?.getAttribute("aria-label") || "chart").slice(0, 24)}: ${size.toFixed(1)}px`; out.set(k, (out.get(k) || 0) + 1); }
  }
  return `${location.pathname} w${innerWidth} small chart text: ` + ([...out].map(([k, n]) => `${k} x${n}`).join("; ") || "none");
};

window.__check = async () => {
  const a = await __sweep(), b = __svgText();
  const bad = !/axe=\[\] overflow=0 spaced=0 clipped=\[\] tiny=0/.test(a) || !/none$/.test(b) || !/h1=1/.test(a);
  return bad ? a + " || " + b : "ok " + location.pathname + location.search + " w" + innerWidth;
};

// sibling pieces of text whose boxes overlap (axis labels printed on top of each other, a label over a bar): neither axe nor a width check can see these
window.__overlap = () => {
  const hits = [];
  for (const parent of document.querySelectorAll("main *")) {
    if (parent.closest("svg") || parent.children.length < 2 || parent.children.length > 60) continue;
    const kids = [...parent.children].filter((c) => c.textContent.trim() && !c.classList.contains("sr-only") && getComputedStyle(c).display !== "none" && getComputedStyle(c).display !== "inline" && getComputedStyle(c).visibility !== "hidden");
    const rects = kids.map((c) => c.getBoundingClientRect());
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.width < 2 || b.width < 2 || a.height < 2 || b.height < 2) continue;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2 && (w * h) / Math.min(a.width * a.height, b.width * b.height) > 0.25) hits.push(`${kids[i].textContent.trim().slice(0, 14)}|${kids[j].textContent.trim().slice(0, 14)}`);
    }
    if (hits.length > 4) break;
  }
  return hits;
};
window.__check = async () => {
  const a = await __sweep(), b = __svgText(), o = __overlap();
  const bad = !/axe=\[\] overflow=0 spaced=0 clipped=\[\] tiny=0/.test(a) || !/none$/.test(b) || !/h1=1/.test(a) || o.length;
  return bad ? a + " || " + b + " || overlap=[" + o.join(" ; ") + "]" : "ok " + location.pathname + location.search + " w" + innerWidth;
};

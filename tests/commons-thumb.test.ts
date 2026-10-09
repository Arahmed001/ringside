import test from "node:test";
import assert from "node:assert/strict";
import { commonsWidthFor, sizedCommons } from "../lib/commons-thumb";

const FILE = "Floyd_Mayweather%2C_Jr._at_DeWalt_event_%285888721735%29_%28rotated_4%29.jpg";
const T500 = `https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7e/${FILE}/500px-${FILE}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail`;

test("the width asked for is the smallest standard one that covers twice the box (a sharp picture on a phone), and nothing for a big box", () => {
  assert.equal(commonsWidthFor(64), 120); assert.equal(commonsWidthFor(68), 120); assert.equal(commonsWidthFor(69), 250); assert.equal(commonsWidthFor(142), 250);
  assert.equal(commonsWidthFor(143), 330); assert.equal(commonsWidthFor(200), 500); assert.equal(commonsWidthFor(290), null, "bigger than the largest kept width: the address is left alone");
});

test("a Commons thumbnail address is made smaller, keeping its file name and query, and is never made bigger", () => {
  assert.equal(sizedCommons(T500, 64), `https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7e/${FILE}/120px-${FILE}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail`);
  assert.equal(sizedCommons(T500, 100), T500.replace("/500px-", "/250px-"));
  assert.equal(sizedCommons(T500, 200), T500, "500 already is the width wanted");
  const t250 = T500.replace("500px", "250px");
  assert.equal(sizedCommons(t250, 250), t250, "never asks for a bigger one than the address already has (the original may be smaller)");
  assert.equal(sizedCommons(t250, 400), t250);
});

test("an original (an address the enrichment stored unscaled) becomes a thumbnail, but only up to 250 px: no photo is accepted narrower than that", () => {
  const orig = "https://upload.wikimedia.org/wikipedia/commons/2/2e/Terence_Crawford_during_a_podcast_in_2023.png?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled";
  assert.equal(sizedCommons(orig, 64), "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2e/Terence_Crawford_during_a_podcast_in_2023.png/120px-Terence_Crawford_during_a_podcast_in_2023.png");
  assert.match(sizedCommons(orig, 100), /\/250px-Terence_Crawford/);
  assert.equal(sizedCommons(orig, 150), orig, "330 px could be wider than the original (a Commons 400): left alone");
});

test("anything else is returned exactly as it was: other hosts, other types, a data address, an empty string", () => {
  for (const u of ["https://example.org/photo.jpg", "https://upload.wikimedia.org/wikipedia/commons/2/2e/Logo.svg", "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Logo.svg/500px-Logo.svg.png", "https://upload.wikimedia.org/wikipedia/en/2/2e/NotCommons.jpg", "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2e/A.gif/500px-A.gif", "data:image/png;base64,AAAA", "", "/api/art/portrait/x"]) assert.equal(sizedCommons(u, 64), u, u);
});

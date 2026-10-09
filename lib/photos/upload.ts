/**
 * Checks and cleans a picture someone sends in. Only a real JPEG or PNG is accepted (judged by its first bytes, never by the name or the type the sender claims), at most 4 MB and
 * between 300 and 8000 pixels on each side. The copy that is kept has its metadata removed: a phone photo carries the place and time it was taken, and the site must not publish
 * that. A JPEG keeps its picture and colour profile, a PNG keeps its picture, palette, transparency and colour chunks; everything else (text, EXIF, XMP, comments) is dropped.
 */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const MIN_SIDE = 300;
export const MAX_SIDE = 8000;
export type UploadError = "empty" | "too_large" | "not_image" | "broken_image" | "too_small" | "too_big_pixels";
export interface CleanUpload { ext: "jpg" | "png"; mime: "image/jpeg" | "image/png"; bytes: Buffer; width: number; height: number }

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "sRGB", "iCCP", "gAMA", "cHRM", "sBIT", "bKGD"]);

function cleanJpeg(b: Buffer): { bytes: Buffer; width: number; height: number } | "broken_image" {
  const out: Buffer[] = [b.subarray(0, 2)];
  let i = 2, width = 0, height = 0;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return "broken_image";
    let m = b[i + 1];
    while (m === 0xff && i + 2 < b.length) { i++; m = b[i + 1]; } // fill bytes
    if (m === 0xd9) { out.push(Buffer.from([0xff, 0xd9])); return width && height ? { bytes: Buffer.concat(out), width, height } : "broken_image"; }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { out.push(b.subarray(i, i + 2)); i += 2; continue; } // markers with no length
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) return "broken_image";
    const seg = b.subarray(i, i + 2 + len);
    if (m === 0xda) { out.push(b.subarray(i)); return width && height ? { bytes: Buffer.concat(out), width, height } : "broken_image"; } // start of scan: the rest is picture data to the end
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { height = b.readUInt16BE(i + 5); width = b.readUInt16BE(i + 7); }
    const keepApp2Icc = m === 0xe2 && seg.subarray(4, 15).toString("latin1") === "ICC_PROFILE";
    const drop = (m >= 0xe1 && m <= 0xef && !keepApp2Icc) || m === 0xfe; // EXIF, XMP, vendor data, comments
    if (!drop) out.push(seg);
    i += 2 + len;
  }
  return "broken_image";
}

function cleanPng(b: Buffer): { bytes: Buffer; width: number; height: number } | "broken_image" {
  const out: Buffer[] = [PNG_SIG];
  let i = 8, width = 0, height = 0, sawEnd = false, sawData = false;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i), type = b.toString("latin1", i + 4, i + 8), end = i + 12 + len;
    if (len > b.length || end > b.length) return "broken_image";
    if (type === "IHDR") { if (len !== 13) return "broken_image"; width = b.readUInt32BE(i + 8); height = b.readUInt32BE(i + 12); }
    if (type === "IDAT") sawData = true;
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") { sawEnd = true; break; }
  }
  return sawEnd && sawData && width && height ? { bytes: Buffer.concat(out), width, height } : "broken_image";
}

export function cleanUpload(input: Uint8Array | Buffer): { ok: true; photo: CleanUpload } | { ok: false; error: UploadError } {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (b.length === 0) return { ok: false, error: "empty" };
  if (b.length > MAX_PHOTO_BYTES) return { ok: false, error: "too_large" };
  const isJpeg = b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, isPng = b.length > 8 && b.subarray(0, 8).equals(PNG_SIG);
  if (!isJpeg && !isPng) return { ok: false, error: "not_image" };
  let r: ReturnType<typeof cleanJpeg>;
  try { r = isJpeg ? cleanJpeg(b) : cleanPng(b); } catch { return { ok: false, error: "broken_image" }; }
  if (r === "broken_image") return { ok: false, error: "broken_image" };
  if (r.width < MIN_SIDE || r.height < MIN_SIDE) return { ok: false, error: "too_small" };
  if (r.width > MAX_SIDE || r.height > MAX_SIDE) return { ok: false, error: "too_big_pixels" };
  return { ok: true, photo: { ext: isJpeg ? "jpg" : "png", mime: isJpeg ? "image/jpeg" : "image/png", bytes: r.bytes, width: r.width, height: r.height } };
}

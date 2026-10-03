import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { htmlToText } from "./text";

/**
 * Evidence that is a file, not a web page: a commission's purse report that arrived as a PDF by email after a public-records request, a
 * response letter, a saved page. The web checker finds a quote by fetching a URL again; a document has no URL, so the proof is different and
 * has to be stated plainly:
 *
 *  - A PERSON registers the document once (`npm run research -- add-document`): its SHA-256 is recorded with who issued it, when it was
 *    received and how, and whether it is an official record. Nobody else can set "official": a claim cannot declare its own evidence official.
 *  - A claim names the document (`"document": "csac-2026-08.pdf"`) instead of a URL. The checker reads the document's text, requires the
 *    quote to be in it word for word and every number to be stated in the quote, exactly as for a page.
 *  - If the file has changed since it was registered, or is not there, the claim is `unconfirmed`. A document cannot be quietly swapped.
 *
 * What this proves: the quote is in the document the owner registered, and the document has not changed since. It does NOT prove the
 * document is genuine: that rests on the person who received it from the issuer. A transcription (typed from a scan) is a person's own
 * words, so it can never be official and never counts as an independent source by itself.
 */
export interface DocumentEntry {
  file: string; sha256: string;
  /** the text the quote is checked against: extracted from a PDF or a saved page; null when the file is itself plain text */
  text: { file: string; sha256: string; via: "pdftotext" | "html" } | null;
  issuer: string; issuerHost: string;
  /** an official record (a commission's own document). Set by a person at registration, never by a claim. Never true for a transcription. */
  official: boolean;
  form: "original" | "transcription";
  receivedAt: string; how: string; registeredAt: string;
}

export const MANIFEST = "manifest.jsonl";
const EXT = new Set([".pdf", ".txt", ".md", ".html", ".htm"]);
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const plainName = (f: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(f) && !f.includes("..");

export type Runner = (cmd: string, args: string[]) => string;
const defaultRun: Runner = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

/** The text layer of a PDF, via poppler's `pdftotext` (a system tool: apt install poppler-utils, brew install poppler). A scan has none. */
export function extractPdfText(file: string, run: Runner = defaultRun): string {
  let out: string;
  try { out = run("pdftotext", ["-layout", file, "-"]); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new Error("pdftotext is not installed (it comes with poppler: `apt install poppler-utils` or `brew install poppler`). Or register a plain-text copy of the document instead.");
    throw new Error(`pdftotext could not read ${path.basename(file)}: ${String((e as Error).message).split("\n")[0]}`);
  }
  return out;
}

export function loadManifest(dir: string): DocumentEntry[] {
  const f = path.join(dir, MANIFEST);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l, i) => { try { return JSON.parse(l) as DocumentEntry; } catch { throw new Error(`${f}:${i + 1} is not valid JSON`); } });
}

export interface RegisterInput { file: string; issuer: string; issuerHost: string; official?: boolean; form?: "original" | "transcription"; receivedAt: string; how: string }

/** Records a document in the manifest. The file must already be in `dir`. Registering the same bytes again is a no-op; different bytes under the same name are refused. */
export function registerDocument(dir: string, input: RegisterInput, o: { run?: Runner; now?: string } = {}): DocumentEntry {
  const { file, issuer, issuerHost, receivedAt, how } = input;
  const form = input.form ?? "original";
  if (!plainName(file)) throw new Error(`"${file}" is not a plain file name: put the document in the documents folder and give its name only`);
  if (!EXT.has(path.extname(file).toLowerCase())) throw new Error(`${file}: documents may be .pdf, .txt, .md or .html`);
  if (!issuer.trim()) throw new Error("say who issued it (--issuer)");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(issuerHost)) throw new Error(`--issuer-host must be the issuer's web domain, like dca.ca.gov (got "${issuerHost}")`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)) throw new Error("--received must be the date it arrived, yyyy-mm-dd");
  if (!how.trim()) throw new Error("say how it was obtained (--how, for example \"public-records response\")");
  if (input.official && form === "transcription") throw new Error("a transcription is your own typing, so it cannot be an official record: register the original, or leave --official off");
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) throw new Error(`${full} does not exist`);
  const bytes = fs.readFileSync(full);
  const hash = sha(bytes);
  const have = loadManifest(dir).find((e) => e.file === file);
  if (have) {
    if (have.sha256 === hash) return have;
    throw new Error(`${file} is already registered with different contents. A document never changes after registration: save the new version under a new name.`);
  }
  const ext = path.extname(file).toLowerCase();
  let text: DocumentEntry["text"] = null;
  if (ext === ".pdf" || ext === ".html" || ext === ".htm") {
    const extracted = ext === ".pdf" ? extractPdfText(full, o.run) : htmlToText(bytes.toString("utf8"));
    if (extracted.replace(/\s+/g, "").length < 40) throw new Error(`${file} has no readable text (a scanned PDF is a picture). Type it out into a .txt file and register that with --transcription; a transcription is not an official record.`);
    const tf = `${file}.txt`;
    fs.writeFileSync(path.join(dir, tf), extracted);
    text = { file: tf, sha256: sha(extracted), via: ext === ".pdf" ? "pdftotext" : "html" };
  }
  const entry: DocumentEntry = { file, sha256: hash, text, issuer: issuer.trim(), issuerHost, official: !!input.official, form, receivedAt, how: how.trim(), registeredAt: o.now ?? new Date().toISOString().slice(0, 10) };
  fs.appendFileSync(path.join(dir, MANIFEST), JSON.stringify(entry) + "\n");
  return entry;
}

export type DocOutcome =
  | { ok: true; entry: DocumentEntry; text: string }
  | { ok: false; reason: "not-registered" | "missing" | "changed"; detail: string };

/** The text of a registered document, after proving nothing has changed since it was registered. */
export function readDocument(dir: string, name: string): DocOutcome {
  if (!plainName(name)) return { ok: false, reason: "not-registered", detail: `"${name}" is not a plain file name` };
  const entry = loadManifest(dir).find((e) => e.file === name);
  if (!entry) return { ok: false, reason: "not-registered", detail: `${name} is not in ${MANIFEST}: register it with \`npm run research -- add-document\`` };
  const full = path.join(dir, name);
  if (!fs.existsSync(full)) return { ok: false, reason: "missing", detail: `${name} is registered but the file is not in ${dir} (documents are kept off the repository: put it back)` };
  const bytes = fs.readFileSync(full);
  if (sha(bytes) !== entry.sha256) return { ok: false, reason: "changed", detail: `${name} has changed since it was registered (its hash no longer matches)` };
  if (!entry.text) return { ok: true, entry, text: bytes.toString("utf8") };
  const tf = path.join(dir, entry.text.file);
  if (!fs.existsSync(tf)) return { ok: false, reason: "missing", detail: `${entry.text.file}, the text taken from ${name}, is missing: register again after removing the entry` };
  const text = fs.readFileSync(tf, "utf8");
  if (sha(text) !== entry.text.sha256) return { ok: false, reason: "changed", detail: `${entry.text.file} (the text of ${name}) has changed since it was extracted` };
  return { ok: true, entry, text };
}

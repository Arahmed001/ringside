import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";
import { extractPdfText, loadManifest, readDocument, registerDocument, type DocumentEntry } from "../lib/research/documents";
import { checkFacts, shapeProblems } from "../lib/research/check";
import { matchFacts } from "../lib/research/match";
import type { ResearchFact } from "../lib/research/types";

/**
 * Evidence that is a file (a purse report that arrived by email). What is proven: the quote is in the document a person registered, and the
 * document has not changed since. What is not: that the document is genuine; that rests on the person who got it from the issuer.
 */
const cleanup = tempDb("research-documents");
after(cleanup);
const roots: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "research-docs-")); roots.push(d); return d; };
after(() => roots.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const PURSE_TEXT = "CALIFORNIA STATE ATHLETIC COMMISSION\nPost-event purse report\nEvent: Test Night, 2026-08-15, Los Angeles\nBoxer A guaranteed purse $500,000 and a bonus of $50,000.\nBoxer B guaranteed purse $300,000.\nPaid attendance 11,250.\n";
const reg = { issuer: "California State Athletic Commission", issuerHost: "dca.ca.gov", receivedAt: "2026-10-10", how: "public-records response" };
const put = (dir: string, name: string, body: string | Buffer) => fs.writeFileSync(path.join(dir, name), body);

test("registering records the hash, who issued it, and what a person said about it; the same bytes again change nothing, other bytes under the name are refused", () => {
  const dir = tmp(); put(dir, "csac-2026-08.txt", PURSE_TEXT);
  const e = registerDocument(dir, { file: "csac-2026-08.txt", ...reg, official: true }, { now: "2026-10-11" });
  assert.deepEqual([e.official, e.form, e.issuerHost, e.text, e.registeredAt], [true, "original", "dca.ca.gov", null, "2026-10-11"]);
  assert.match(e.sha256, /^[0-9a-f]{64}$/);
  assert.equal(loadManifest(dir).length, 1);
  assert.deepEqual(registerDocument(dir, { file: "csac-2026-08.txt", ...reg, official: true }), e, "same bytes: a no-op");
  assert.equal(loadManifest(dir).length, 1);
  put(dir, "csac-2026-08.txt", PURSE_TEXT.replace("500,000", "900,000"));
  assert.throws(() => registerDocument(dir, { file: "csac-2026-08.txt", ...reg }), /already registered with different contents.*new name/);
});

test("registration refuses what would make the evidence meaningless", () => {
  const dir = tmp(); put(dir, "a.txt", PURSE_TEXT); put(dir, "b.exe", "x");
  const bad = (over: object, re: RegExp) => assert.throws(() => registerDocument(dir, { file: "a.txt", ...reg, ...over } as never), re);
  bad({ file: "../a.txt" }, /plain file name/); bad({ file: "sub/a.txt" }, /plain file name/);
  assert.throws(() => registerDocument(dir, { file: "b.exe", ...reg }), /\.pdf, \.txt/);
  bad({ issuer: " " }, /who issued it/); bad({ issuerHost: "dca" }, /web domain/); bad({ issuerHost: "https://dca.ca.gov" }, /web domain/);
  bad({ receivedAt: "10/10/2026" }, /yyyy-mm-dd/); bad({ how: "" }, /how it was obtained/);
  bad({ official: true, form: "transcription" }, /transcription is your own typing.*cannot be an official/);
  assert.throws(() => registerDocument(dir, { file: "missing.txt", ...reg }), /does not exist/);
  assert.equal(loadManifest(dir).length, 0, "nothing was recorded by any refusal");
});

test("a PDF's text comes from pdftotext (injected here); a scan with no text layer is refused with the way out; a missing tool says how to install it", () => {
  const dir = tmp(); put(dir, "r.pdf", "%PDF-1.4 not a real pdf");
  const calls: string[][] = [];
  const e = registerDocument(dir, { file: "r.pdf", ...reg, official: true }, { run: (cmd, args) => { calls.push([cmd, ...args]); return PURSE_TEXT; } });
  assert.deepEqual(calls[0].slice(0, 2), ["pdftotext", "-layout"]);
  assert.deepEqual([e.text?.file, e.text?.via], ["r.pdf.txt", "pdftotext"]);
  assert.equal(readDocument(dir, "r.pdf").ok, true);
  const scan = tmp(); put(scan, "s.pdf", "%PDF");
  assert.throws(() => registerDocument(scan, { file: "s.pdf", ...reg }, { run: () => "  \n " }), /no readable text.*transcription.*not an official record/);
  assert.equal(loadManifest(scan).length, 0);
  assert.throws(() => extractPdfText("x.pdf", () => { throw Object.assign(new Error("spawn pdftotext ENOENT"), { code: "ENOENT" }); }), /pdftotext is not installed.*poppler/);
  assert.throws(() => extractPdfText("x.pdf", () => { throw new Error("Syntax Error: Couldn't read xref table\nmore"); }), /could not read x\.pdf: Syntax Error/);
});

const hasPdftotext = spawnSync("pdftotext", ["-v"]).error === undefined;
test("a real PDF round-trips through pdftotext", { skip: hasPdftotext ? false : "pdftotext (poppler) is not installed on this machine" }, () => {
  const dir = tmp();
  const lines = ["Post-event purse report", "Boxer A guaranteed purse $500,000", "Paid attendance 11,250 for the card"];
  const stream = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length; pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  put(dir, "real.pdf", pdf);
  const e = registerDocument(dir, { file: "real.pdf", ...reg, official: true });
  const r = readDocument(dir, "real.pdf");
  assert.ok(r.ok && /Boxer A guaranteed purse \$500,000/.test(r.text) && /11,250/.test(r.text), e.text?.file);
});

test("reading a document proves it is the one registered: unregistered, missing, or changed since, it is refused with the reason", () => {
  const dir = tmp(); put(dir, "d.txt", PURSE_TEXT); registerDocument(dir, { file: "d.txt", ...reg });
  assert.equal(readDocument(dir, "d.txt").ok, true);
  const un = readDocument(dir, "nope.txt"); assert.ok(!un.ok && un.reason === "not-registered" && /add-document/.test(un.detail));
  assert.ok(!readDocument(dir, "../d.txt").ok);
  put(dir, "d.txt", PURSE_TEXT.replace("$500,000", "$900,000"));
  const ch = readDocument(dir, "d.txt"); assert.ok(!ch.ok && ch.reason === "changed" && /hash no longer matches/.test(ch.detail), "a quietly edited document is caught");
  fs.rmSync(path.join(dir, "d.txt"));
  const mi = readDocument(dir, "d.txt"); assert.ok(!mi.ok && mi.reason === "missing" && /kept off the repository/.test(mi.detail));
  // the extracted text is part of the proof too
  const p = tmp(); put(p, "p.pdf", "%PDF"); registerDocument(p, { file: "p.pdf", ...reg }, { run: () => PURSE_TEXT });
  put(p, "p.pdf.txt", PURSE_TEXT.replace("300,000", "800,000"));
  const tx = readDocument(p, "p.pdf"); assert.ok(!tx.ok && tx.reason === "changed" && /text of p\.pdf/.test(tx.detail));
});

// ---------- the checker ----------
const EV = { name: "Test Night", date: "2026-08-15", fighters: ["Boxer A", "Boxer B"] };
const claim = (over: Partial<ResearchFact> = {}): ResearchFact => ({
  kind: "purse", event: EV, fighter: "Boxer A", values: { guaranteedUsd: 500_000, bonusUsd: 50_000 }, basis: "disclosed", source: "California State Athletic Commission (public-records response)",
  document: "d.txt", quote: "Boxer A guaranteed purse $500,000 and a bonus of $50,000.", ...over,
});
function store(form: "original" | "transcription" = "original", official = true, host = "dca.ca.gov") {
  const dir = tmp(); put(dir, "d.txt", PURSE_TEXT);
  registerDocument(dir, { file: "d.txt", ...reg, issuerHost: host, official, form });
  return { dir, getDocument: (n: string) => readDocument(dir, n) };
}
const noWeb = async () => { throw new Error("no web request should be made for a document"); };

test("an official document alone verifies a figure: the quote is in it word for word and states every number", async () => {
  const s = store();
  const [c] = await checkFacts([claim()], { getPage: noWeb, getDocument: s.getDocument });
  assert.equal(c.status, "verified", c.reasons.join(";")); assert.deepEqual(c.reasons, ["official record"]);
  assert.deepEqual([c.host, c.doc?.official, c.doc?.file, c.doc?.issuer], ["ca.gov", true, "d.txt", "California State Athletic Commission"]);
  assert.match(c.doc!.sha256, /^[0-9a-f]{64}$/);
});

test("a document that is not marked official needs a second independent source, like any single site", async () => {
  const s = store("original", false);
  const [c] = await checkFacts([claim()], { getPage: noWeb, getDocument: s.getDocument });
  assert.equal(c.status, "single_source");
  const web = async () => ({ ok: true as const, url: "u", text: "ESPN: Boxer A was guaranteed $500,000 plus $50,000 in bonuses", fromCache: false, status: 200 });
  const both = await checkFacts([claim(), { ...claim(), document: undefined, sourceUrl: "https://espn.com/x", source: "ESPN", basis: "reported", quote: "Boxer A was guaranteed $500,000 plus $50,000 in bonuses" }], { getPage: web, getDocument: s.getDocument });
  assert.deepEqual(both.map((x) => x.status), ["verified", "verified"], "a document and an independent site agree");
});

test("a transcription can never be official, whatever the claim says", async () => {
  const s = store("transcription", false);
  const [c] = await checkFacts([claim({ basis: "disclosed" })], { getPage: noWeb, getDocument: s.getDocument });
  assert.deepEqual([c.status, c.doc?.official], ["single_source", false]);
  // registration refuses "official transcription", but the manifest is a file: one edited by hand to say so is not believed either
  const m = loadManifest(s.dir).map((e): DocumentEntry => ({ ...e, official: true }));
  fs.writeFileSync(path.join(s.dir, "manifest.jsonl"), m.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const [h] = await checkFacts([claim({ basis: "disclosed" })], { getPage: noWeb, getDocument: s.getDocument });
  assert.deepEqual([h.status, h.doc?.official], ["single_source", false], "form 'transcription' is never official, whatever the manifest says");
});

test("a quote that is not in the document, a number it does not state, a changed or unregistered file, and a missing store are each unconfirmed with the reason", async () => {
  const s = store();
  const status = async (f: ResearchFact, getDocument = s.getDocument) => (await checkFacts([f], { getPage: noWeb, getDocument }))[0];
  const a = await status(claim({ quote: "Boxer A guaranteed purse $700,000 and a bonus of $50,000." })); assert.equal(a.status, "unconfirmed"); assert.match(a.reasons[0], /quote is not in the document/);
  const b = await status(claim({ values: { guaranteedUsd: 600_000 } })); assert.equal(b.status, "unconfirmed"); assert.match(b.reasons[0], /does not state: guaranteedUsd/);
  const c = await status(claim({ document: "other.txt" })); assert.equal(c.status, "unconfirmed"); assert.match(c.reasons[0], /not in manifest\.jsonl/);
  put(s.dir, "d.txt", PURSE_TEXT.replace("$500,000", "$600,000"));
  const d = await status(claim()); assert.equal(d.status, "unconfirmed"); assert.match(d.reasons[0], /changed since it was registered/);
  const e = await checkFacts([claim()], { getPage: noWeb }); assert.match(e[0].reasons[0], /no document store/);
});

test("a claim names a page or a document, never both and never neither, and a document name must be plain", () => {
  assert.deepEqual(shapeProblems(claim()), []);
  assert.ok(shapeProblems(claim({ sourceUrl: "https://x.com/a" })).some((p) => /not both/.test(p)));
  assert.ok(shapeProblems(claim({ document: undefined })).some((p) => /sourceUrl must be an http\(s\) link \(or name a registered document\)/.test(p)));
  assert.ok(shapeProblems(claim({ document: "../x.txt" })).some((p) => /plain name/.test(p)));
  assert.ok(shapeProblems(claim({ document: "a/b.txt" })).some((p) => /plain name/.test(p)));
});

test("promotion keeps the document's own provenance: official stays disclosed, otherwise it is reported, and the note names the document and its hash", async () => {
  const { getDb } = await import("../lib/db");
  const db: DatabaseSync = await getDb();
  const row = db.prepare(`SELECT b.external_id bout, e.name en, e.date date, r.name rn, u.name un FROM bouts b JOIN events e ON e.id=b.event_id JOIN boxers r ON r.id=b.red_id JOIN boxers u ON u.id=b.blue_id WHERE b.method IS NOT NULL LIMIT 1 OFFSET 40`).get() as { bout: string; en: string; date: string; rn: string; un: string };
  const ev = { name: row.en, date: row.date, fighters: [row.rn, row.un] };
  const quote = `${row.rn} guaranteed purse $500,000 and a bonus of $50,000.`;
  const dir = tmp(); put(dir, "d.txt", `${PURSE_TEXT}\n${quote}\n`);
  for (const [official, form, expectBasis] of [[true, "original", "disclosed"], [false, "original", "reported"], [false, "transcription", "reported"]] as const) {
    const d2 = tmp(); put(d2, "d.txt", `${PURSE_TEXT}\n${quote}\n`);
    registerDocument(d2, { file: "d.txt", ...reg, official, form });
    const checked = await checkFacts([claim({ event: ev, fighter: row.rn, quote, values: { guaranteedUsd: 500_000, bonusUsd: 50_000 } })], { getPage: noWeb, getDocument: (n) => readDocument(d2, n) });
    const m = matchFacts(db, checked, { allowSingleSource: true, today: "2026-10-03" });
    assert.equal(m.rows.purses.length, 1, `${official}/${form}`);
    assert.equal(m.rows.purses[0].basis, expectBasis, `${official}/${form}`);
    assert.match(m.rows.purses[0].note ?? "", /document d\.txt \(sha256 [0-9a-f]{12}\), California State Athletic Commission, received 2026-10-10/);
    assert.equal(m.rows.purses[0].sourceUrl, undefined, "no web address is invented for a document");
    if (form === "transcription") assert.match(m.rows.purses[0].note ?? "", /transcribed/);
  }
});

// ---------- the command ----------
function cli(args: string[], root: string, env: Record<string, string | undefined> = {}) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const c = spawn(process.execPath, ["--import", "tsx", "scripts/research.ts", ...args], { cwd: process.cwd(), env: { ...process.env, RESEARCH_DIR: root, RESEARCH_CONTACT: undefined, RINGSIDE_NOW: "2026-10-03", ...env } });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => resolve({ code, out }));
  });
}

test("the command: register, lint, check with no network and no contact, notice a changed file, list the documents", async () => {
  const root = tmp(), manual = path.join(root, "manual"), inbox = path.join(root, "inbox");
  fs.mkdirSync(manual, { recursive: true }); fs.mkdirSync(inbox, { recursive: true });
  put(manual, "csac.txt", PURSE_TEXT);
  fs.writeFileSync(path.join(inbox, "csac.jsonl"), JSON.stringify(claim({ document: "csac.txt" })) + "\n");

  const unreg = await cli(["lint"], root);
  assert.equal(unreg.code, 1); assert.match(unreg.out, /document csac\.txt is not registered/);

  const both = await cli(["add-document", "csac.txt", "--issuer", "California State Athletic Commission", "--issuer-host", "dca.ca.gov", "--received", "2026-10-10", "--how", "public-records response", "--official", "--transcription"], root);
  assert.equal(both.code, 1); assert.match(both.out, /cannot be an official record/);

  const add = await cli(["add-document", "csac.txt", "--issuer", "California State Athletic Commission", "--issuer-host", "dca.ca.gov", "--received", "2026-10-10", "--how", "public-records response", "--official"], root);
  assert.equal(add.code, 0, add.out); assert.match(add.out, /registered csac\.txt: sha256 [0-9a-f]{16}\.\.\., California State Athletic Commission \(dca\.ca\.gov\), received 2026-10-10, an official record/);
  const lint = await cli(["lint"], root); assert.equal(lint.code, 0, lint.out); assert.match(lint.out, /1 claims, 0 decisions, 0 malformed/);

  const check = await cli(["check"], root);
  assert.equal(check.code, 0, check.out); assert.match(check.out, /\{ verified: 1 \}|verified: 1/, "no RESEARCH_CONTACT was needed: nothing touched the network");
  const checked = JSON.parse(fs.readFileSync(path.join(root, "checked.jsonl"), "utf8").trim());
  assert.deepEqual([checked.status, checked.doc.official, checked.doc.file], ["verified", true, "csac.txt"]);

  assert.equal((await cli(["documents"], root)).code, 0);
  put(manual, "csac.txt", PURSE_TEXT.replace("$500,000", "$600,000")); // somebody edits the document
  const docs = await cli(["documents"], root); assert.equal(docs.code, 1); assert.match(docs.out, /PROBLEM csac\.txt.*changed since it was registered/);
  const again = await cli(["check"], root); assert.match(again.out, /unconfirmed: 1|unconfirmed/); assert.match(again.out, /changed since it was registered/);
});

// Consistency test: the same header must always produce the same verdict, score and findings.
// Runs with plain Node (no dependencies): node tools/test-engine.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console, TextDecoder, TextEncoder, Blob, Response, DecompressionStream, atob, Uint8Array, Uint32Array, Float64Array };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["data/world.js", "data/threat.js", "data/geo.js", "js/analyze.js", "js/geodb.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const { HL, HLGeo } = ctx;
const db = await HLGeo.load();
if (!db) { console.error("FAIL offline data did not load"); process.exit(1); }

const expected = JSON.parse(fs.readFileSync(path.join(root, "test/expected.json"), "utf8"));
const run = (text) => {
  const r = HL.analyze(text, { lookup: HLGeo.lookup, dataVersion: HLGeo.info() });
  return JSON.stringify({ v: r.verdict, s: r.score, c: r.confidence, f: r.findings.map((x) => [x.sev, x.points, x.title, x.detail]), h: r.routing.hops.map((x) => [x.ip, x.date, x.tls, x.delay]) });
};
let fail = 0;
for (const file of Object.keys(expected)) {
  const text = fs.readFileSync(path.join(root, "test", file), "utf8");
  const base = run(text);
  const variants = {
    "repeat run": text,
    "CRLF line endings": text.replace(/\n/g, "\r\n"),
    "trailing spaces": text.replace(/\n/g, "  \n"),
    "leading blank lines and BOM": "﻿\n\n" + text,
    "message body appended": text.trimEnd() + "\n\nHello, this is the body.\nReceived: not a header\n"
  };
  for (const [name, v] of Object.entries(variants)) {
    if (run(v) !== base) { console.error(`FAIL ${file}: result changed with ${name}`); fail = 1; }
  }
  const r = JSON.parse(base);
  const want = expected[file];
  if (r.v !== want.verdict) { console.error(`FAIL ${file}: verdict ${r.v}, expected ${want.verdict}`); fail = 1; }
  if (r.s < want.min || r.s > want.max) { console.error(`FAIL ${file}: score ${r.s} outside ${want.min}-${want.max}`); fail = 1; }
  console.log(`${fail ? "…" : "ok"}  ${file}: ${r.v} ${r.s}/100 (${r.c})`);
}
process.exit(fail);

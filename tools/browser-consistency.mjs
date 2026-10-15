// Cross-browser check: the same header must give the same score, verdict and fingerprint
// in Chromium, Firefox and WebKit (Safari's engine). Serves the site locally; no external requests.
// Usage: node tools/browser-consistency.mjs [chromium,firefox,webkit]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const engines = { chromium, firefox, webkit };
const wanted = (process.argv[2] || "chromium,firefox,webkit").split(",");
const files = Object.keys(JSON.parse(fs.readFileSync(path.join(root, "test/expected.json"), "utf8")));
const results = {};
for (const name of wanted) {
  const browser = await engines[name].launch(process.env.CHROMIUM_PATH && name === "chromium" ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  for (const f of files) {
    await page.goto(url);
    await page.fill("#header-input", fs.readFileSync(path.join(root, "test", f), "utf8"));
    await page.click("#analyze-btn");
    await page.waitForSelector(".verdict", { timeout: 30000 });
    await page.waitForFunction(() => !/computing/.test(document.querySelector(".v-fp").textContent));
    const r = await page.evaluate(() => [document.querySelector(".ring-num").textContent, document.querySelector(".verdict h2").textContent, document.querySelector(".v-fp .mono").getAttribute("title")]);
    (results[f] ||= {})[name] = r.join(" | ");
  }
  await browser.close();
}
server.close();
let fail = 0;
for (const [f, byBrowser] of Object.entries(results)) {
  const distinct = new Set(Object.values(byBrowser));
  console.log(`${distinct.size === 1 ? "ok  " : "FAIL"} ${f}`);
  for (const [b, v] of Object.entries(byBrowser)) console.log(`     ${b.padEnd(8)} ${v}`);
  if (distinct.size !== 1) fail = 1;
}
process.exit(fail);

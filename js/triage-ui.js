// Email triage page. Builds all UI with DOM methods (no innerHTML). No storage, no network, nothing kept after leaving.
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var input = $("raw-input"), statusEl = $("input-status"), fileInput = $("file-input"), drop = $("drop-zone");
  var viewInput = $("view-input"), viewDash = $("view-dash"), analyzeBtn = $("analyze-btn");
  var MAX = 25 * 1024 * 1024;
  var current = null; // { kind: "file"|"text", name, bytes }

  // Brand links from config; hide any left empty (same rules as the header page).
  var cfg = window.HL_CONFIG || {};
  document.querySelectorAll("[data-link]").forEach(function (a) {
    var url = cfg[a.getAttribute("data-link")];
    if (url && /^https:\/\//.test(url)) a.href = url;
    else if (a.closest(".links")) a.classList.add("hidden");
    else { a.removeAttribute("href"); a.removeAttribute("target"); }
  });
  $("year").textContent = String(new Date().getFullYear());

  // ---------- DOM helpers ----------
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v; else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    (Array.isArray(kids) ? kids : [kids]).forEach(function (c) { if (c === null || c === undefined || c === false) return; el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c); });
    return el;
  }
  function pill(kind, text) { return h("span", { class: "pill pill-" + kind, text: text }); }
  var SEVK = { high: "bad", med: "warn", low: "low", info: "neutral", good: "good", ok: "good" };
  function fmtSize(n) { return n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
  function copyBtn(getText, label) {
    var b = h("button", { class: "btn btn-ghost btn-sm", type: "button" }, label || "Copy");
    b.addEventListener("click", function () { navigator.clipboard.writeText(getText()).then(function () { var o = b.textContent; b.textContent = "Copied"; setTimeout(function () { b.textContent = o; }, 1400); }, function () {}); });
    return b;
  }
  function setStatus(msg, kind) { statusEl.textContent = msg; statusEl.className = "status" + (kind ? " " + kind : ""); }

  // ---------- Offline data (same files as the header page) ----------
  var dataPromise = null;
  function loadScript(src) { return new Promise(function (res) { var el = document.createElement("script"); el.src = src; el.async = true; el.onload = function () { res(true); }; el.onerror = function () { res(false); }; document.head.appendChild(el); }); }
  function loadData() {
    if (!dataPromise) dataPromise = Promise.all(["data/world.js", "data/threat.js", "data/geo.js"].map(loadScript)).then(function () { return window.HLGeo.load(); });
    return dataPromise;
  }

  // ---------- Input ----------
  function showFile(name, size, note) {
    $("file-name").textContent = name; $("file-meta").textContent = fmtSize(size) + (note ? " · " + note : "");
    $("file-chip").classList.remove("hidden"); input.classList.add("hidden");
  }
  function clearFile() { current = null; $("file-chip").classList.add("hidden"); input.classList.remove("hidden"); }
  function describe() {
    if (current && current.kind === "file") { setStatus("Ready to analyze " + current.name, "ok"); return true; }
    var t = input.value;
    if (!t.trim()) { setStatus("Waiting for an email"); return false; }
    var hs = window.HL.parse(t), hasBody = /\r?\n\r?\n[\s\S]*\S/.test(t.replace(/^\s+/, ""));
    if (!hs.length) { setStatus("That doesn't look like an email. Paste the full message source, starting with the headers.", "err"); return false; }
    setStatus(hs.length + " headers" + (hasBody ? " and a message body" : ", no body found (only headers will be analyzed)") + " · ready", hasBody ? "ok" : "warn");
    return true;
  }
  input.addEventListener("input", function () { describe(); loadData(); });
  function loadFile(file) {
    if (!file) return;
    if (file.size > MAX) { setStatus("That file is over 25 MB, which is larger than an email should be.", "err"); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var bytes = new Uint8Array(reader.result);
      var isMsg = window.TriageMime.looksLikeMsg(bytes);
      current = { kind: "file", name: file.name, bytes: bytes, msg: isMsg };
      showFile(file.name, file.size, isMsg ? "Outlook message" : "email file");
      describe(); loadData();
    };
    reader.onerror = function () { setStatus("Couldn't read that file.", "err"); };
    reader.readAsArrayBuffer(file);
  }
  fileInput.addEventListener("change", function () { loadFile(fileInput.files[0]); fileInput.value = ""; });
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("dragging"); }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("dragging"); }); });
  drop.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]); });
  $("file-remove").addEventListener("click", function () { clearFile(); describe(); });
  $("sample-btn").addEventListener("click", function () { clearFile(); input.value = window.TRIAGE_SAMPLE || ""; describe(); loadData(); });

  function showInput() {
    window.HLDash.clear(null);
    viewDash.textContent = "";
    viewDash.classList.add("hidden"); viewInput.classList.remove("hidden");
    document.body.classList.remove("is-dash");
  }
  function clearAll() { input.value = ""; clearFile(); showInput(); setStatus("Waiting for an email"); }
  $("clear-btn").addEventListener("click", function () { clearAll(); input.focus(); });

  analyzeBtn.addEventListener("click", function () {
    if (!describe()) { input.focus(); return; }
    analyzeBtn.disabled = true; analyzeBtn.textContent = "Analyzing…";
    setStatus("Reading the email and loading offline data…");
    var src = current;
    loadData().then(function (db) {
      if (!db) throw new Error("data");
      var parsed, raw;
      if (src && src.kind === "file") {
        raw = src.bytes;
        parsed = src.msg ? window.TriageMsg.parse(src.bytes.buffer.slice(src.bytes.byteOffset, src.bytes.byteOffset + src.bytes.byteLength)) : window.TriageMime.parse(src.bytes.buffer.slice(src.bytes.byteOffset, src.bytes.byteOffset + src.bytes.byteLength));
      } else {
        var text = input.value.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
        raw = new TextEncoder().encode(text);
        parsed = window.TriageMime.parse(text);
      }
      return window.Triage.run(parsed, { lookup: window.HLGeo.lookup, dataVersion: window.HLGeo.info() }).then(function (r) {
        r.fileName = src && src.kind === "file" ? src.name : "";
        return fingerprint(r, raw).then(function () { return r; });
      });
    }).then(function (r) {
      render(r);
      viewInput.classList.add("hidden"); viewDash.classList.remove("hidden");
      document.body.classList.add("is-dash");
      window.scrollTo(0, 0); viewDash.focus({ preventScroll: true });
      describe();
    }).catch(function (e) {
      setStatus(e && e.message === "data" ? "The offline IP data didn't load, so the analysis was stopped. Reload the page and try again." : "Couldn't analyze this email: " + (e && e.message ? e.message : "unreadable format") + ".", "err");
    }).then(function () { analyzeBtn.disabled = false; analyzeBtn.textContent = "Analyze email"; });
  });

  window.addEventListener("pagehide", clearAll);
  window.addEventListener("pageshow", function (e) { if (e.persisted) clearAll(); });
  clearAll();

  function fingerprint(r, raw) {
    var d = r.dataVersion, pre = new TextEncoder().encode("triage " + r.engine + "|header " + r.headerEngine + "|" + (d ? d.built + "|" + d.threatBuilt : "") + "\n");
    var all = new Uint8Array(pre.length + raw.length); all.set(pre); all.set(raw, pre.length);
    if (!window.crypto || !window.crypto.subtle) { r.fingerprint = "unavailable"; return Promise.resolve(); }
    return window.crypto.subtle.digest("SHA-256", all).then(function (buf) { r.fingerprint = Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); });
  }

  // ---------- Results ----------
  var VERD = { phish: ["Likely phishing", "v-phish"], suspicious: ["Suspicious", "v-susp"], genuine: ["Likely genuine", "v-good"], inconclusive: ["Inconclusive", "v-inc"] };
  function areaKind(v) { return v >= 55 ? "bad" : v >= 25 ? "warn" : "good"; }

  function verdictBanner(r) {
    var V = VERD[r.verdict], H = r.header;
    var R = 34, C = 2 * Math.PI * R, NS = "http://www.w3.org/2000/svg";
    var ring = document.createElementNS(NS, "svg");
    ring.setAttribute("viewBox", "0 0 84 84"); ring.setAttribute("class", "ring"); ring.setAttribute("role", "img"); ring.setAttribute("aria-label", "Risk score " + r.score + " of 100");
    [["circle", { cx: 42, cy: 42, r: R, class: "ring-bg", fill: "none", "stroke-width": 8 }], ["circle", { cx: 42, cy: 42, r: R, class: "ring-fg", fill: "none", "stroke-width": 8, "stroke-linecap": "round", "stroke-dasharray": (C * r.score / 100).toFixed(1) + " " + C.toFixed(1), transform: "rotate(-90 42 42)" }], ["text", { x: 42, y: 46, "text-anchor": "middle", class: "ring-num", t: String(r.score) }], ["text", { x: 42, y: 60, "text-anchor": "middle", class: "ring-sub", t: "of 100" }]].forEach(function (d) {
      var el = document.createElementNS(NS, d[0]); for (var k in d[1]) { if (k === "t") el.textContent = d[1][k]; else el.setAttribute(k, d[1][k]); } ring.appendChild(el);
    });
    var who = H.identity.from ? (H.identity.from.display ? H.identity.from.display + " <" + H.identity.from.address + ">" : H.identity.from.address) : "Unknown sender";
    var reasons = H.findings.filter(function (f) { return f.points > 0 && f.sev === "high"; }).slice(0, 2).map(function (f) { return f.title; })
      .concat(r.findings.filter(function (f) { return f.sev === "high"; }).slice(0, 3).map(function (f) { return f.title.length > 70 ? f.title.slice(0, 68) + "…" : f.title; }));
    var c = r.completeness, note = null;
    if (c && c.level !== "complete") note = h("div", { class: "v-incomplete " + (c.level === "minimal" ? "inc-min" : "inc-part"), role: "note" }, [h("div", null, [h("strong", { text: c.level === "minimal" ? "Incomplete header: this result may be inaccurate" : "Partial header: some results may be inaccurate" }), h("span", { text: "Missing " + c.missing.map(function (m) { return m.name + " (" + m.why + ")"; }).join(", ") + ". Use the original .eml or .msg file, not a forwarded copy." })])]);
    var d = r.dataVersion;
    return h("section", { class: "verdict " + V[1], "aria-label": "Verdict" }, [ring, h("div", { class: "v-body" }, [
      h("p", { class: "v-kicker", text: "Email verdict · " + r.confidence + " confidence" }),
      h("h2", { text: V[0] }),
      h("p", { class: "v-meta" }, [h("span", { text: who }), r.parsed.subject ? h("span", { class: "v-subj", text: r.parsed.subject }) : null, r.fileName ? h("span", { class: "v-subj", text: r.fileName }) : null]),
      h("div", { class: "area-chips" }, [["Headers", r.areas.headers], ["Body and links", r.areas.body], ["Attachments", r.areas.attachments]].map(function (a) { return h("span", { class: "area pill-" + areaKind(a[1]) }, [h("span", { text: a[0] }), h("strong", { text: String(a[1]) })]); })),
      reasons.length ? h("div", { class: "chips" }, reasons.map(function (t) { return pill("bad", t); })) : h("div", { class: "chips" }, [pill("good", "No high-risk signals found")]),
      note,
      h("p", { class: "v-fp", title: "The same email analysed with the same engine and data always gives this fingerprint and the same score." }, ["Fingerprint ", h("span", { class: "mono", text: (r.fingerprint || "").slice(0, 16), title: r.fingerprint }), " · triage " + r.engine + " · header engine " + r.headerEngine + (d ? " · IP data " + d.built + " · threat data " + d.threatBuilt : "")])
    ])]);
  }

  function findingList(list) {
    if (!list.length) return h("p", { class: "empty", text: "No issues found here." });
    return h("ul", { class: "findings" }, list.map(function (f) { return h("li", { class: "finding sev-" + f.sev }, [h("span", { class: "fdot fdot-" + (SEVK[f.sev] || "neutral") }), h("div", null, [h("strong", { text: f.title }), f.detail ? h("span", { text: f.detail }) : null])]); }));
  }
  function card(title, sub, body, action, cls) {
    return h("section", { class: "card tcard" + (cls ? " " + cls : "") }, [h("div", { class: "card-h" }, [h("div", { class: "card-t" }, [h("h3", { text: title }), sub ? h("p", { text: sub }) : null]), action || null]), body]);
  }

  function linkRow(l, compact) {
    var flags = l.flags.filter(function (f) { return f[0] !== "info" || !compact; });
    return h("div", { class: "lrow lrow-" + l.risk }, [
      h("span", { class: "lnum", text: String(l.n) }),
      h("div", { class: "lmain" }, [
        h("div", { class: "lurl mono", text: l.url }),
        l.text && l.text !== l.url ? h("div", { class: "ltext" }, ["Shown as: ", h("span", { text: l.text.slice(0, 140) })]) : null,
        l.wrappers.length ? h("div", { class: "ltext" }, ["Unwrapped from " + l.wrappers.join(" › ")]) : null,
        !compact && l.raw !== l.url ? h("div", { class: "ltext mono", text: "Original: " + l.raw.slice(0, 200) + (l.raw.length > 200 ? "…" : "") }) : null,
        flags.length ? h("div", { class: "chips" }, flags.map(function (f) { return pill(SEVK[f[0]] || "neutral", f[1]); })) : null
      ]),
      h("span", { class: "lsrc", text: l.source })
    ]);
  }

  function attCard(a) {
    var hs = a.hashes || {};
    return h("div", { class: "att att-" + a.risk }, [
      h("div", { class: "att-h" }, [h("strong", { class: "att-name", text: a.name }), pill(SEVK[a.risk] || "neutral", a.risk === "ok" ? "No issues" : a.risk === "high" ? "High risk" : a.risk === "med" ? "Medium risk" : "Low risk")]),
      h("div", { class: "kvs two" }, [kvRow("Size", fmtSize(a.size)), kvRow("Declared type", a.contentType || "—"), kvRow("Real content", a.real), kvRow("Extension", a.ext ? "." + a.ext : "none")]),
      a.flags.length ? h("div", { class: "chips att-flags" }, a.flags.map(function (f) { return pill(SEVK[f[0]], f[1]); })) : null,
      a.qr ? h("p", { class: "note" }, ["QR code: ", h("span", { class: "mono", text: a.qr })]) : null,
      a.entries && a.entries.length ? h("details", { class: "att-entries" }, [h("summary", { text: "Archive contents (" + a.entries.length + ")" }), h("ul", null, a.entries.slice(0, 200).map(function (n) { return h("li", { class: "mono", text: n }); }))]) : null,
      h("div", { class: "hashes" }, [["SHA-256", hs.sha256], ["SHA-1", hs.sha1], ["MD5", hs.md5]].filter(function (x) { return x[1]; }).map(function (x) { return h("div", { class: "hash" }, [h("span", { class: "muted", text: x[0] }), h("span", { class: "mono", text: x[1] }), copyBtn(function () { return x[1]; })]); }))
    ]);
  }
  function kvRow(k, v) { return h("div", { class: "kv" }, [h("span", { class: "k", text: k }), h("span", { class: "v", text: v })]); }

  function previewCard(r, full) {
    var H = r.header, from = H.identity.from;
    var txt = r.preview || "(no text body)";
    if (!full && txt.length > 1200) txt = txt.slice(0, 1200) + "…";
    return h("div", { class: "preview" }, [
      h("div", { class: "pv-head" }, [
        h("div", null, [h("span", { class: "muted", text: "From " }), h("span", { text: from ? from.raw : "—" })]),
        h("div", null, [h("span", { class: "muted", text: "Subject " }), h("strong", { text: r.parsed.subject || "—" })])
      ]),
      h("div", { class: "pv-body", text: txt }),
      r.cues.length ? h("div", { class: "chips" }, r.cues.map(function (c) { return pill("warn", c); })) : null,
      h("p", { class: "note", text: "Shown as plain text. Links appear as [n] and match the numbers in the link list; nothing is loaded or run." })
    ]);
  }

  function iocPanel(r) {
    var io = r.iocs, defanged = true;
    var wrap = h("div", { class: "iocs" });
    var fmt = function (s) { return defanged ? window.Triage.defang(s) : s; };
    function group(title, items, getText) {
      if (!items.length) return null;
      var listEl = h("ul", { class: "ioc-list" });
      function fill() { listEl.textContent = ""; items.forEach(function (x) { listEl.appendChild(h("li", { class: "mono", text: getText(x) })); }); }
      fill(); listEl._fill = fill;
      return h("div", { class: "ioc-g" }, [h("div", { class: "ioc-h" }, [h("strong", { text: title + " (" + items.length + ")" }), copyBtn(function () { return items.map(getText).join("\n"); })]), listEl]);
    }
    var groups = [
      group("Sender addresses", io.emails, function (x) { return fmt(x); }),
      group("Domains", io.domains, function (x) { return fmt(x); }),
      group("IP addresses", io.ips, function (x) { return fmt(x); }),
      group("URLs", io.urls, function (x) { return fmt(x); }),
      group("File hashes (SHA-256)", io.hashes, function (x) { return x.sha256 + "  " + x.name; })
    ].filter(Boolean);
    var toggle = h("label", { class: "toggle" }, [h("input", { type: "checkbox", checked: true }), " Defang (hxxp, [.]) for safe sharing"]);
    toggle.querySelector("input").addEventListener("change", function (e) { defanged = e.target.checked; groups.forEach(function (g) { var ul = g.querySelector(".ioc-list"); if (ul && ul._fill) ul._fill(); }); });
    var allBtn = copyBtn(function () { return [io.emails, io.domains, io.ips, io.urls].map(function (l) { return l.map(fmt).join("\n"); }).concat([io.hashes.map(function (x) { return x.sha256; }).join("\n")]).filter(Boolean).join("\n"); }, "Copy all");
    var csvBtn = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Export CSV", onclick: function () { download("email-iocs.csv", iocCsv(r), "text/csv"); } });
    wrap.appendChild(h("div", { class: "ioc-bar" }, [toggle, h("div", { class: "dash-actions" }, [allBtn, csvBtn])]));
    if (!groups.length) wrap.appendChild(h("p", { class: "empty", text: "No indicators extracted." }));
    groups.forEach(function (g) { wrap.appendChild(g); });
    [["Microsoft Sentinel / Defender (KQL)", r.queries.kql], ["Splunk (SPL)", r.queries.spl]].forEach(function (qd) {
      if (!qd[1]) return;
      wrap.appendChild(h("div", { class: "ioc-g" }, [h("div", { class: "ioc-h" }, [h("strong", { text: qd[0] }), copyBtn(function () { return qd[1]; })]), h("pre", { class: "query", text: qd[1] })]));
    });
    wrap.appendChild(h("p", { class: "note", text: "Adjust table, index and field names to your environment. Mail-provider IPs (Microsoft, Google) are left out of the IP list." }));
    return wrap;
  }

  function csvCell(v) { v = String(v === null || v === undefined ? "" : v); return /^[=+\-@\t\r]/.test(v) ? "\"'" + v.replace(/"/g, "\"\"") + "\"" : "\"" + v.replace(/"/g, "\"\"") + "\""; }
  function iocCsv(r) {
    var rows = [["type", "value", "context"]], io = r.iocs;
    io.emails.forEach(function (x) { rows.push(["email", x, "sender"]); });
    io.domains.forEach(function (x) { rows.push(["domain", x, ""]); });
    io.ips.forEach(function (x) { rows.push(["ip", x, ""]); });
    io.urls.forEach(function (x) { rows.push(["url", x, ""]); });
    io.hashes.forEach(function (x) { rows.push(["sha256", x.sha256, x.name]); rows.push(["sha1", x.sha1, x.name]); rows.push(["md5", x.md5, x.name]); });
    rows.push(["verdict", r.verdict + " " + r.score + "/100", "fingerprint " + r.fingerprint]);
    return rows.map(function (row) { return row.map(csvCell).join(","); }).join("\r\n");
  }
  function download(name, text, type) { var url = URL.createObjectURL(new Blob([text], { type: type })); var a = h("a", { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); }
  function summary(r) {
    var H = r.header, L = ["Email triage report (header-lens)", "Verdict: " + r.verdict + " (" + r.score + "/100, " + r.confidence + " confidence)", "Areas: headers " + r.areas.headers + ", body and links " + r.areas.body + ", attachments " + r.areas.attachments, "Fingerprint: " + r.fingerprint];
    if (H.identity.from) L.push("From: " + H.identity.from.raw);
    if (r.parsed.subject) L.push("Subject: " + r.parsed.subject);
    L.push("", "Header findings:"); H.findings.filter(function (f) { return f.sev !== "good"; }).forEach(function (f) { L.push("- [" + f.sev + "] " + f.title); });
    L.push("", "Content findings:"); r.findings.forEach(function (f) { L.push("- [" + f.sev + "] " + f.title + (f.detail ? ": " + f.detail : "")); });
    L.push("", "IOCs (defanged):"); r.iocs.domains.concat(r.iocs.ips, r.iocs.urls).forEach(function (x) { L.push("- " + window.Triage.defang(x)); }); r.iocs.hashes.forEach(function (x) { L.push("- " + x.sha256 + " " + x.name); });
    return L.join("\n");
  }

  function render(r) {
    viewDash.textContent = "";
    var H = r.header;
    var bar = h("div", { class: "dash-bar" }, [
      h("button", { class: "btn btn-ghost", type: "button", text: "‹ New analysis", onclick: function () { clearAll(); input.focus(); } }),
      h("div", { class: "dash-actions" }, [copyBtn(function () { return summary(r); }, "Copy summary"), h("button", { class: "btn btn-ghost", type: "button", text: "Export IOCs (CSV)", onclick: function () { download("email-iocs.csv", iocCsv(r), "text/csv"); } })])
    ]);
    var risky = r.links.filter(function (l) { return l.risk === "high" || l.risk === "med"; });
    var tabs = [
      { id: "overview", label: "Overview" },
      { id: "headers", label: "Headers", count: H.findings.filter(function (f) { return f.sev !== "good" && f.sev !== "info"; }).length },
      { id: "body", label: "Body and links", count: r.links.length },
      { id: "attachments", label: "Attachments", count: r.attachments.length },
      { id: "iocs", label: "IOCs", count: r.iocs.domains.length + r.iocs.ips.length + r.iocs.urls.length + r.iocs.hashes.length + r.iocs.emails.length }
    ];
    var tablist = h("div", { class: "ttabs", role: "tablist", "aria-label": "Result sections" });
    var panels = {};
    tabs.forEach(function (t, i) {
      var btn = h("button", { class: "ttab", role: "tab", type: "button", id: "tab-" + t.id, "aria-controls": "panel-" + t.id, "aria-selected": i === 0 ? "true" : "false", tabindex: i === 0 ? "0" : "-1" }, [t.label, t.count !== undefined ? h("span", { class: "tcount", text: String(t.count) }) : null]);
      btn.addEventListener("click", function () { select(t.id); });
      btn.addEventListener("keydown", function (e) { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { var k = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length; select(tabs[k].id); document.getElementById("tab-" + tabs[k].id).focus(); } });
      tablist.appendChild(btn);
      panels[t.id] = h("div", { class: "tpanel" + (i ? " hidden" : ""), role: "tabpanel", id: "panel-" + t.id, "aria-labelledby": "tab-" + t.id });
    });
    function select(id) {
      tabs.forEach(function (t) { var on = t.id === id; var b = document.getElementById("tab-" + t.id); b.setAttribute("aria-selected", on ? "true" : "false"); b.tabIndex = on ? 0 : -1; panels[t.id].classList.toggle("hidden", !on); });
      if (id === "headers" && !panels.headers.firstChild) {
        panels.headers.appendChild(h("p", { class: "note tab-note", text: "Header-only analysis, identical to the Header analysis page. The email verdict above combines it with links and attachments." }));
        var hostEl = h("div"); panels.headers.appendChild(hostEl);
        window.HLDash.render(hostEl, H, { back: function () { clearAll(); input.focus(); } });
      }
      document.body.classList.toggle("tab-headers", id === "headers");
    }

    // Overview
    var authPills = H.auth.checks.map(function (c) { return pill(c.state === "pass" ? "good" : c.state === "fail" ? "bad" : c.state === "warn" ? "warn" : "neutral", c.key + " " + (c.result === "none" ? "—" : c.result)); });
    var go = function (id) { return h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Open", onclick: function () { select(id); window.scrollTo(0, tablist.offsetTop - 12); } }); };
    panels.overview.appendChild(h("div", { class: "tgrid" }, [
      h("div", { class: "tcol" }, [
        card("Headers", "Score " + r.areas.headers + " · " + H.routing.hops.length + " hops", h("div", null, [h("div", { class: "chips" }, authPills), findingList(H.findings.filter(function (f) { return f.sev === "high" || f.sev === "med"; }).slice(0, 4).map(function (f) { return { sev: f.sev, title: f.title, detail: f.detail }; }))]), go("headers")),
        card("Links", "Score " + r.areas.body + " · " + r.links.length + " found, " + risky.length + " risky", risky.length ? h("div", { class: "lrows" }, risky.slice(0, 4).map(function (l) { return linkRow(l, true); })) : h("p", { class: "empty", text: r.links.length ? "No risky links." : "No links in this email." }), go("body")),
        card("Attachments", "Score " + r.areas.attachments + " · " + r.attachments.length + " file" + (r.attachments.length === 1 ? "" : "s"), r.attachments.length ? h("div", { class: "att-mini" }, r.attachments.map(function (a) { return h("div", { class: "am" }, [h("span", { class: "fdot fdot-" + (SEVK[a.risk] || "neutral") }), h("strong", { text: a.name }), h("span", { class: "muted", text: a.real + " · " + fmtSize(a.size) }), a.flags.length ? h("span", { class: "am-f", text: a.flags[0][1] }) : null]); })) : h("p", { class: "empty", text: "No attachments." }), go("attachments"))
      ]),
      h("div", { class: "tcol" }, [card("Safe preview", "What the recipient saw, as plain text", previewCard(r, false)), card("Content findings", "Body, links, QR codes and attachments", findingList(r.findings))])
    ]));
    // Body and links
    panels.body.appendChild(h("div", { class: "tgrid" }, [
      h("div", { class: "tcol" }, [card("Links (" + r.links.length + ")", "Real destination after unwrapping security gateways", r.links.length ? h("div", { class: "lrows" }, r.links.map(function (l) { return linkRow(l, false); })) : h("p", { class: "empty", text: "No links found." }))]),
      h("div", { class: "tcol" }, [card("Message body", "Plain-text preview", previewCard(r, true)), r.qr.length ? card("QR codes", "Decoded from images", h("ul", { class: "qr-list" }, r.qr.map(function (q) { return h("li", null, [h("span", { class: "muted", text: q.where + ": " }), h("span", { class: "mono", text: q.text })]); }))) : null])
    ]));
    // Attachments
    panels.attachments.appendChild(r.attachments.length ? h("div", { class: "atts" }, r.attachments.map(attCard)) : h("p", { class: "empty", text: "This email has no attachments." }));
    // IOCs
    panels.iocs.appendChild(card("Indicators of compromise", "Extracted from headers, links and attachments", iocPanel(r)));

    var parseWarn = r.parsed.warnings.length ? h("p", { class: "note warnline", text: r.parsed.warnings.join(" ") }) : null;
    viewDash.appendChild(h("div", { class: "tdash" }, [bar, verdictBanner(r), parseWarn, tablist].concat(tabs.map(function (t) { return panels[t.id]; }))));
  }
})();

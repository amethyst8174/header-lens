// header-lens input page.
// Privacy rules for this file: no browser storage, cookies, network calls or URL
// parameters. Everything lives in memory and is wiped on page exit.
// The Privacy check workflow enforces this on every push.
(function () {
  "use strict";

  var input = document.getElementById("header-input");
  var statusEl = document.getElementById("input-status");
  var fileInput = document.getElementById("file-input");
  var drop = document.getElementById("drop-zone");
  var MAX_BYTES = 5 * 1024 * 1024;

  // Brand links from config; hide any left empty.
  var cfg = window.HL_CONFIG || {};
  document.querySelectorAll("[data-link]").forEach(function (a) {
    var url = cfg[a.getAttribute("data-link")];
    if (url && /^https:\/\//.test(url)) {
      a.href = url;
    } else if (a.closest(".links")) {
      a.classList.add("hidden");
    } else {
      a.removeAttribute("href");
      a.removeAttribute("target");
    }
  });
  document.getElementById("year").textContent = String(new Date().getFullYear());

  // Keep only the header block of a full message (headers end at the first blank line).
  function headerBlock(text) {
    var t = text.replace(/\r\n?/g, "\n").replace(/^﻿/, "").replace(/^\s+/, "");
    var end = t.search(/\n[ \t]*\n/);
    return end === -1 ? t : t.slice(0, end);
  }

  // Unfold continuation lines and split into name/value pairs.
  function parseHeaders(text) {
    var out = [];
    headerBlock(text).split("\n").forEach(function (line) {
      if (/^[ \t]/.test(line) && out.length) {
        out[out.length - 1].value += " " + line.trim();
        return;
      }
      var m = line.match(/^([!-9;-~]+):[ \t]?(.*)$/);
      if (m) out.push({ name: m[1], value: m[2] });
    });
    return out;
  }

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function describe() {
    var text = input.value;
    if (!text.trim()) { setStatus("Waiting for headers"); return null; }
    var headers = parseHeaders(text);
    var hops = headers.filter(function (h) { return /^received$/i.test(h.name); }).length;
    var hasFrom = headers.some(function (h) { return /^from$/i.test(h.name); });
    if (!headers.length) { setStatus("No headers found. Paste the header block, starting with Received: or From:", "err"); return null; }
    var msg = headers.length + " headers · " + hops + " Received hop" + (hops === 1 ? "" : "s");
    if (!hops || !hasFrom) {
      setStatus(msg + " · missing " + (!hops ? "Received" : "From") + " headers, results may be partial", "warn");
    } else {
      setStatus(msg + " · ready to analyze", "ok");
    }
    return headers;
  }

  var timer;
  input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(describe, 150); });

  function loadFile(file) {
    if (!file) return;
    if (file.size > MAX_BYTES) { setStatus("That file is over 5 MB. Paste just the headers instead.", "err"); return; }
    var reader = new FileReader();
    reader.onload = function () { input.value = headerBlock(String(reader.result)); describe(); };
    reader.onerror = function () { setStatus("Couldn't read that file. Paste the headers instead.", "err"); };
    reader.readAsText(file);
  }

  fileInput.addEventListener("change", function () { loadFile(fileInput.files[0]); fileInput.value = ""; });

  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("dragging"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("dragging"); });
  });
  drop.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
  });

  function clearAll() {
    input.value = "";
    window.HL_SESSION = null;
    setStatus("Waiting for headers");
  }
  document.getElementById("clear-btn").addEventListener("click", function () { clearAll(); input.focus(); });

  document.getElementById("sample-btn").addEventListener("click", function () {
    input.value = SAMPLE;
    describe();
  });

  document.getElementById("analyze-btn").addEventListener("click", function () {
    var headers = describe();
    if (!headers) { input.focus(); return; }
    // Held in memory only, for the dashboard view (next build).
    window.HL_SESSION = { headers: headers };
    setStatus(headers.length + " headers parsed in your browser · dashboard view arrives in the next build", "ok");
  });

  // Wipe everything when the page is hidden, closed, or restored from the back/forward cache.
  window.addEventListener("pagehide", clearAll);
  window.addEventListener("pageshow", function (e) { if (e.persisted) clearAll(); });
  clearAll();

  // Sample uses documentation-only IP ranges and example domains.
  var SAMPLE = [
    "Received: from DB8EUR05HT123.eop-eur05.prod.protection.outlook.com (10.0.4.12) by",
    " AM0PR04MB1234.eurprd04.prod.outlook.com with HTTPS; Wed, 14 Oct 2026 10:18:24 +0000",
    "Received: from mx.bulk-relay.example (203.0.113.45) by",
    " DB8EUR05FT021.mail.protection.outlook.com (40.107.22.81) with Microsoft SMTP",
    " Server (version=TLS1_2, cipher=TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384) id 15.20.7;",
    " Wed, 14 Oct 2026 10:18:20 +0000",
    "Received: from vps-31.host.example ([198.51.100.23]) by mx.bulk-relay.example",
    " (Postfix) with SMTP id 4F2A1C; Wed, 14 Oct 2026 10:05:06 +0000",
    "Authentication-Results: spf=fail (sender IP is 203.0.113.45)",
    " smtp.mailfrom=mailer-x.example; dkim=pass (signature was verified)",
    " header.d=mailer-x.example;dmarc=fail action=quarantine",
    " header.from=yourc0.example;compauth=fail reason=000",
    "Received-SPF: Fail (protection.outlook.com: domain of mailer-x.example does not",
    " designate 203.0.113.45 as permitted sender) receiver=protection.outlook.com;",
    " client-ip=203.0.113.45; helo=mx.bulk-relay.example;",
    "DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=mailer-x.example; s=s1;",
    " h=from:reply-to:subject:date; bh=placeholder; b=placeholder",
    "Return-Path: bounce@mailer-x.example",
    "From: \"HR Department\" <hr@yourc0.example>",
    "Reply-To: payroll@freemail.example",
    "To: ravi@yourco.example",
    "Delivered-To: ravi@yourco.example",
    "Subject: Salary revision Q4 - action required",
    "Date: Wed, 14 Oct 2026 10:05:02 +0000",
    "Message-ID: <20261014100502.4F2A1C@vps-31.host.example>",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=\"b1\"",
    "Content-Transfer-Encoding: 7bit",
    "X-Mailer: PHPMailer 5.2.4",
    "X-Originating-IP: [198.51.100.23]",
    "X-MS-Exchange-Organization-SCL: 6",
    "X-MS-Exchange-Organization-PCL: 8",
    "X-MS-Exchange-Organization-AVStamp-Service: 1.0",
    "X-Forefront-Antispam-Report: CIP:203.0.113.45;CTRY:RU;LANG:en;SCL:6;SRV:;",
    " IPV:NLI;SFV:SPM;H:mx.bulk-relay.example;PTR:InfoNoRecords;CAT:PHSH;SFS:;DIR:INB;",
    "X-Microsoft-Antispam: BCL:1;",
    "X-MS-Exchange-CrossTenant-AuthAs: Anonymous",
    "X-MS-Exchange-CrossTenant-AuthSource: DB8EUR05FT021.eop-eur05.prod.protection.outlook.com",
    "X-MS-Exchange-Organization-Network-Message-Id: 6b1f2c3d-0000-4000-8000-123456789abc"
  ].join("\n");
})();

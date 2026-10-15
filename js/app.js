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

  var headerBlock = window.HL.headerBlock, parseHeaders = window.HL.parse;
  var viewInput = document.getElementById("view-input"), viewDash = document.getElementById("view-dash");
  var analyzeBtn = document.getElementById("analyze-btn");

  // Offline data (IP country/ASN, threat lists, world map) is loaded from this site on first use.
  var dataPromise = null;
  function loadScript(src) {
    return new Promise(function (resolve) {
      var el = document.createElement("script");
      el.src = src; el.async = true;
      el.onload = function () { resolve(true); };
      el.onerror = function () { resolve(false); };
      document.head.appendChild(el);
    });
  }
  function loadData() {
    if (!dataPromise) dataPromise = Promise.all(["data/world.js", "data/threat.js", "data/geo.js"].map(loadScript)).then(function () { return window.HLGeo.load(); });
    return dataPromise;
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
  input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(describe, 150); loadData(); });

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

  function showInput() {
    window.HLDash.clear(viewDash);
    viewDash.classList.add("hidden");
    viewInput.classList.remove("hidden");
    document.body.classList.remove("is-dash");
  }
  function clearAll() {
    input.value = "";
    showInput();
    setStatus("Waiting for headers");
  }
  document.getElementById("clear-btn").addEventListener("click", function () { clearAll(); input.focus(); });

  document.getElementById("sample-btn").addEventListener("click", function () {
    input.value = SAMPLE;
    describe();
  });

  analyzeBtn.addEventListener("click", function () {
    var headers = describe();
    if (!headers) { input.focus(); return; }
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Analyzing…";
    setStatus("Loading offline IP data (first run only)…");
    loadData().then(function (db) {
      var result = window.HL.analyze(input.value, { lookup: db ? window.HLGeo.lookup : null });
      window.HLDash.render(viewDash, result, { back: function () { clearAll(); input.focus(); } });
      viewInput.classList.add("hidden");
      viewDash.classList.remove("hidden");
      document.body.classList.add("is-dash");
      window.scrollTo(0, 0);
      viewDash.focus({ preventScroll: true });
      describe();
    }).catch(function () {
      setStatus("Something went wrong while analyzing. Check the headers and try again.", "err");
    }).then(function () {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = "Analyze headers";
    });
  });

  // Wipe everything when the page is hidden, closed, or restored from the back/forward cache.
  window.addEventListener("pagehide", clearAll);
  window.addEventListener("pageshow", function (e) { if (e.persisted) clearAll(); });
  clearAll();

  // Fictional sample: example domains, a relay on a public threat list, and a hosting-network origin.
  var SAMPLE = [
    "Received: from AM9PR04MB8412.eurprd04.prod.outlook.com (2603:10a6:20b:3e1::14) by",
    " DB9PR04MB9618.eurprd04.prod.outlook.com with HTTPS; Wed, 14 Oct 2026 10:18:24 +0000",
    "Received: from DB8EUR05FT021.eop-eur05.prod.protection.outlook.com (2603:10a6:20b:3e1::4)",
    " by AM9PR04MB8412.eurprd04.prod.outlook.com (2603:10a6:20b:3e1::14) with Microsoft SMTP",
    " Server (version=TLS1_2, cipher=TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384) id 15.20.7;",
    " Wed, 14 Oct 2026 10:18:21 +0000",
    "Received: from mx.bulk-relay.example (76.74.52.17) by",
    " DB8EUR05FT021.mail.protection.outlook.com (40.107.22.81) with Microsoft SMTP",
    " Server id 15.20.7 via Frontend Transport; Wed, 14 Oct 2026 10:18:20 +0000",
    "Received: from vps-31.host.example (unknown [159.89.10.20]) by mx.bulk-relay.example",
    " (Postfix) with SMTP id 4F2A1C; Wed, 14 Oct 2026 10:05:06 +0000",
    "Authentication-Results: spf=fail (sender IP is 76.74.52.17)",
    " smtp.mailfrom=mailer-x.example; dkim=pass (signature was verified)",
    " header.d=mailer-x.example;dmarc=fail action=quarantine",
    " header.from=yourc0.com;compauth=fail reason=000",
    "Received-SPF: Fail (protection.outlook.com: domain of mailer-x.example does not",
    " designate 76.74.52.17 as permitted sender) receiver=protection.outlook.com;",
    " client-ip=76.74.52.17; helo=mx.bulk-relay.example;",
    "DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=mailer-x.example; s=s1;",
    " h=from:reply-to:subject:date; bh=placeholder; b=placeholder",
    "Return-Path: bounce@mailer-x.example",
    "From: \"HR Department\" <hr@yourc0.com>",
    "Reply-To: payroll.desk@gmail.com",
    "To: ravi@yourco.com",
    "Delivered-To: ravi@yourco.com",
    "Subject: =?UTF-8?B?U2FsYXJ5IHJldmlzaW9uIFE0IOKAkyBhY3Rpb24gcmVxdWlyZWQ=?=",
    "Date: Wed, 14 Oct 2026 10:05:02 +0000",
    "Message-ID: <20261014100502.4F2A1C@vps-31.host.example>",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=\"b1\"",
    "Content-Transfer-Encoding: 7bit",
    "X-Mailer: PHPMailer 5.2.4 (https://github.com/PHPMailer/PHPMailer)",
    "X-Originating-IP: [159.89.10.20]",
    "X-MS-Exchange-Organization-SCL: 6",
    "X-MS-Exchange-Organization-PCL: 8",
    "X-MS-Exchange-Organization-AVStamp-Service: 1.0",
    "X-Forefront-Antispam-Report: CIP:76.74.52.17;CTRY:US;LANG:en;SCL:6;SRV:;",
    " IPV:NLI;SFV:SPM;H:mx.bulk-relay.example;PTR:InfoNoRecords;CAT:PHSH;SFTY:9.25;SFS:;DIR:INB;",
    "X-Microsoft-Antispam: BCL:1;",
    "X-MS-Exchange-CrossTenant-AuthAs: Anonymous",
    "X-MS-Exchange-CrossTenant-AuthSource: DB8EUR05FT021.eop-eur05.prod.protection.outlook.com",
    "X-MS-Exchange-CrossTenant-FromEntityHeader: Internet",
    "X-MS-Exchange-Organization-Network-Message-Id: 6b1f2c3d-0000-4000-8000-123456789abc",
    "X-MS-Exchange-CrossTenant-Id: 72f988bf-86f1-41af-91ab-2d7cd011db47"
  ].join("\n");
})();

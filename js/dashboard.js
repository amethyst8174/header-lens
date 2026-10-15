// header-lens dashboard renderer. Builds every element with DOM methods (no innerHTML),
// so header content can never run as code. No storage, no network.
(function (root) {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    append(el, kids);
    return el;
  }
  function s(tag, attrs, kids) {
    var el = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] === null || attrs[k] === undefined) continue;
      if (k === "text") el.textContent = attrs[k];
      else if (k === "class") el.setAttribute("class", attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    if (kids === null || kids === undefined) return;
    if (!Array.isArray(kids)) kids = [kids];
    kids.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
  }

  // Line icons (24px grid, stroke-based)
  var ICONS = {
    route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h4M18 9v6a4 4 0 0 1-4 4h-4",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0",
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4",
    file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h4",
    globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
    lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
    bug: "M9 8a3 3 0 0 1 6 0M8 10h8v5a4 4 0 0 1-8 0v-5zM4 13h4M16 13h4M5 8l3 2M19 8l-3 2M5 19l3-2M19 19l-3-2",
    code: "M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14",
    alert: "M12 4l9 16H3L12 4zM12 10v4M12 17h.01",
    check: "M5 12l5 5 9-10",
    x: "M6 6l12 12M18 6L6 18",
    minus: "M6 12h12",
    info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
    copy: "M9 9h11v11H9zM5 15V4h11",
    download: "M12 4v11M7 10l5 5 5-5M5 20h14",
    back: "M15 6l-6 6 6 6",
    panel: "M4 5h16v14H4zM15 5v14",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
    image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
    expand: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"
  };
  function icon(name, cls) {
    return s("svg", { viewBox: "0 0 24 24", class: "ic " + (cls || ""), "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" }, s("path", { d: ICONS[name] }));
  }

  var SEV = { high: { label: "High risk", icon: "alert" }, med: { label: "Medium risk", icon: "alert" }, low: { label: "Low risk", icon: "info" }, info: { label: "Info", icon: "info" }, good: { label: "Good sign", icon: "check" } };
  var STATE = { pass: { icon: "check", label: "Pass" }, fail: { icon: "x", label: "Fail" }, warn: { icon: "alert", label: "Soft fail" }, none: { icon: "minus", label: "None" } };

  function pill(kind, text, ic) { return h("span", { class: "pill pill-" + kind }, [ic ? icon(ic) : null, text]); }
  function fmtTime(ms) {
    if (ms === null || ms === undefined) return "—";
    var d = new Date(ms);
    return d.toISOString().slice(0, 10) + " " + d.toISOString().slice(11, 19) + " UTC";
  }
  function fmtClock(ms) { return ms === null || ms === undefined ? "—" : new Date(ms).toISOString().slice(11, 19); }
  function kv(label, value, extra) {
    return h("div", { class: "kv" }, [h("span", { class: "k", text: label }), h("span", { class: "v" + (value ? "" : " muted"), title: value || "" }, [value || "Not present", extra || null])]);
  }

  var current = null, onJump = null;

  // Text with optional line breaks after dots, colons, hyphens and slashes, so hostnames and IPs wrap at separators.
  function breakable(text) {
    var span = document.createElement("span");
    String(text).split(/(?<=[.:\-/@_])/).forEach(function (part, i) {
      if (i) span.appendChild(document.createElement("wbr"));
      span.appendChild(document.createTextNode(part));
    });
    return span;
  }

  // ---------- Card frame ----------
  function card(n, key, title, ic, sub, findings, body, wide, action) {
    var mine = findings.filter(function (f) { return f.section === key && f.sev !== "good"; });
    var worst = mine.length ? mine[0].sev : "ok";
    var head = h("div", { class: "card-h" }, [
      h("span", { class: "card-ic ci-" + key }, icon(ic)),
      h("div", { class: "card-t" }, [h("h3", null, [h("span", { class: "card-n", text: n }), title]), sub ? h("p", { text: sub }) : null]),
      action || null,
      mine.length ? h("span", { class: "count sev-" + worst, title: mine.length + " finding" + (mine.length > 1 ? "s" : "") }, [icon(SEV[worst].icon), String(mine.length)]) : h("span", { class: "count sev-ok", title: "No issues" }, [icon("check"), "Clear"])
    ]);
    var list = mine.length ? h("ul", { class: "findings" }, mine.map(findingRow)) : null;
    var cls = wide === true ? " wide" : typeof wide === "string" ? " " + wide : "";
    return h("section", { class: "card card-" + key + cls, "aria-label": title }, [head, body, list]);
  }
  function findingRow(f) {
    var row = h("li", { class: "finding sev-" + f.sev }, [icon(SEV[f.sev].icon), h("div", null, [h("strong", { text: f.title }), f.detail ? h("span", { text: f.detail }) : null])]);
    if (f.header !== undefined && f.header !== null) {
      row.classList.add("linkable");
      row.setAttribute("tabindex", "0");
      row.setAttribute("title", "Show the source header");
      var go = function () { if (onJump) onJump(f.header); };
      row.addEventListener("click", go);
      row.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    }
    return row;
  }

  // ---------- Verdict ----------
  function verdict(r) {
    var V = { phish: { t: "Likely phishing", cls: "v-phish", ic: "alert" }, suspicious: { t: "Suspicious", cls: "v-susp", ic: "alert" }, genuine: { t: "Likely genuine", cls: "v-good", ic: "check" } }[r.verdict];
    var R = 34, C = 2 * Math.PI * R;
    var ring = s("svg", { viewBox: "0 0 84 84", class: "ring", role: "img", "aria-label": "Risk score " + r.score + " out of 100" }, [
      s("circle", { cx: 42, cy: 42, r: R, class: "ring-bg", fill: "none", "stroke-width": 8 }),
      s("circle", { cx: 42, cy: 42, r: R, class: "ring-fg", fill: "none", "stroke-width": 8, "stroke-linecap": "round", "stroke-dasharray": (C * r.score / 100).toFixed(1) + " " + C.toFixed(1), transform: "rotate(-90 42 42)" }),
      s("text", { x: 42, y: 46, "text-anchor": "middle", class: "ring-num", text: String(r.score) }),
      s("text", { x: 42, y: 60, "text-anchor": "middle", class: "ring-sub", text: "of 100" })
    ]);
    var reasons = r.findings.filter(function (f) { return f.points > 0 && f.sev !== "info"; }).slice(0, 5);
    var goods = r.findings.filter(function (f) { return f.sev === "good"; });
    var subj = r.metadata.subject;
    var who = r.identity.from ? (r.identity.from.display ? r.identity.from.display + " <" + r.identity.from.address + ">" : r.identity.from.address) : "Unknown sender";
    return h("section", { class: "verdict " + V.cls, "aria-label": "Verdict" }, [
      ring,
      h("div", { class: "v-body" }, [
        h("p", { class: "v-kicker" }, [icon(V.ic), "Verdict · " + r.confidence + " confidence"]),
        h("h2", { text: V.t }),
        h("p", { class: "v-meta", title: who + (subj ? " · " + subj : "") }, [h("span", { text: who }), subj ? h("span", { class: "v-subj", text: subj }) : null]),
        h("div", { class: "chips" }, reasons.length ? reasons.map(function (f) { return pill(f.sev === "high" ? "bad" : f.sev === "med" ? "warn" : "low", f.title); }).concat(goods.map(function (f) { return pill("good", f.title, "check"); }))
          : goods.map(function (f) { return pill("good", f.title, "check"); }).concat([pill("good", "No risk signals found", "check")]))
      ])
    ]);
  }

  // ---------- 1. Routing ----------
  function hopState(r, hop) {
    return hop.geo && hop.geo.threats && hop.geo.threats.length ? "bad" : hop.suspicious ? "warn" : hop.providerInternal || (hop.kind && !hop.kind.public) || !hop.ip ? "int" : "ok";
  }
  function tlsText(hop) { return hop.tls === "tls" ? (hop.tlsVer || "TLS") : hop.tls === "plain" ? "No TLS" : hop.tls === "internal" ? "Internal" : "TLS unknown"; }

  // Horizontal flow for the card: compact boxes, long values wrap instead of being cut off.
  function routing(r) {
    var hops = r.routing.hops;
    var flow = h("ol", { class: "flow", "aria-label": "Delivery path, earliest hop first" });
    if (!hops.length) flow.appendChild(h("li", { class: "empty", text: "No Received headers, so the delivery path can't be traced." }));
    hops.forEach(function (hop, i) {
      var st = hopState(r, hop);
      var label = hop.fromHost || hop.rdns || (hop.ip ? hop.ip : "Local submission");
      var delay = hop.delay === null ? "" : (hop.delay < 0 ? "−" : "+") + HL.fmtDur(hop.delay);
      var delayCls = hop.delay === null ? "" : hop.delay < -120 || hop.delay > 3600 ? "d-bad" : hop.delay > 600 ? "d-warn" : "";
      flow.appendChild(h("li", { class: "hop hop-" + st, title: hop.raw }, [
        i ? h("span", { class: "link " + delayCls }, [s("svg", { class: "arrow", viewBox: "0 0 44 12", width: 44, height: 12, "aria-hidden": "true" }, [s("line", { x1: 0, y1: 6, x2: 38, y2: 6, "stroke-width": 2 }), s("path", { d: "M36 1l7 5-7 5z", "stroke-width": 0 })]), delay ? h("span", { class: "delay", text: delay }) : null]) : null,
        h("div", { class: "hop-c" }, [
          h("div", { class: "dot" }, h("span", { text: String(hop.n) })),
          h("div", { class: "hop-t" }, [
            h("strong", { class: "wrap" }, breakable(label)),
            h("span", { class: "mono wrap" }, breakable(hop.ip || "No IP recorded")),
            h("span", { class: "mono muted", text: fmtClock(hop.date) }),
            h("span", { class: "tags" }, [
              r.routing.originHop === hop ? pill("blue", "Origin") : null,
              pill(hop.tls === "tls" ? "good" : hop.tls === "plain" ? "warn" : "neutral", tlsText(hop), hop.tls === "tls" ? "lock" : null),
              hop.geo && hop.geo.cc ? pill("neutral", hop.geo.cc) : null
            ]),
            hop.flags.length ? h("span", { class: "hop-flag", text: hop.flags.join(" · ") }) : null
          ])
        ])
      ]));
    });
    var legend = h("div", { class: "legend" }, [
      h("span", null, [h("i", { class: "lg lg-ok" }), "External, no issues"]), h("span", null, [h("i", { class: "lg lg-warn" }), "Suspicious"]),
      h("span", null, [h("i", { class: "lg lg-bad" }), "On a threat list"]), h("span", null, [h("i", { class: "lg lg-int" }), "Internal or provider network"])
    ]);
    var facts = h("div", { class: "facts" }, [
      kv("Return-Path", r.routing.returnPath ? r.routing.returnPath.address : ""),
      kv("Delivered-To", r.routing.deliveredTo ? r.routing.deliveredTo.address : ""),
      kv("X-Originating-IP", r.routing.xOrigIP),
      kv("Connecting server", r.routing.connecting)
    ]);
    return h("div", null, [flow, legend, facts]);
  }

  // Vertical timeline with every detail, shown in the "View full details" dialog.
  function routingFull(r) {
    var hops = r.routing.hops;
    function nextDelay(nx) {
      if (nx.delay === null) return null;
      var cls = nx.delay < -120 || nx.delay > 3600 ? "d-bad" : nx.delay > 600 ? "d-warn" : "";
      return h("span", { class: "vdelay " + cls, title: "Time to hop " + nx.n, text: (nx.delay < 0 ? "−" : "+") + HL.fmtDur(nx.delay) });
    }
    // Vertical timeline: one full-width row per hop so long hostnames and IPv6 addresses never truncate.
    var flow = h("ol", { class: "vflow", "aria-label": "Delivery path, earliest hop first" });
    if (!hops.length) flow.appendChild(h("li", { class: "empty", text: "No Received headers, so the delivery path can't be traced." }));
    hops.forEach(function (hop, i) {
      var st = hopState(r, hop);
      var label = hop.fromHost || hop.rdns || (hop.ip ? hop.ip : "Local submission");
      var isOrigin = r.routing.originHop === hop;
      var tlsTxt = tlsText(hop);
      var g = hop.geo;
      var where = g ? [g.country || g.cc, g.asn ? "AS" + g.asn + " " + g.asnName : ""].filter(Boolean).join(" · ") : (hop.kind && !hop.kind.public ? (hop.kind.label || "Private") + " network" : "");
      var last = i === hops.length - 1;
      var node = h("li", { class: "vhop hop-" + st }, [
        h("div", { class: "vrail" }, [
          h("div", { class: "dot" }, h("span", { text: String(hop.n) })),
          last ? null : h("span", { class: "vline" }),
          last ? null : nextDelay(hops[i + 1])
        ]),
        h("div", { class: "vcard" }, [
          h("div", { class: "vhead" }, [
            h("strong", { class: "vhost" }, breakable(label)),
            h("span", { class: "tags" }, [
              isOrigin ? pill("blue", "Origin") : null,
              pill(hop.tls === "tls" ? "good" : hop.tls === "plain" ? "warn" : "neutral", tlsTxt, hop.tls === "tls" ? "lock" : null),
              g && g.cc ? pill("neutral", g.cc) : null
            ])
          ]),
          h("div", { class: "vmeta" }, [
            h("span", { class: "mono vip" }, breakable(hop.ip || "No IP recorded")),
            h("span", { class: "mono muted", text: fmtTime(hop.date) }),
            hop.rdns && hop.rdns !== label.toLowerCase() ? h("span", { class: "muted" }, ["rDNS ", h("span", { class: "mono", text: hop.rdns })]) : null
          ]),
          where ? h("div", { class: "vwhere muted", text: where }) : null,
          hop.byHost ? h("div", { class: "vby" }, [h("span", { class: "muted", text: "Received by " }), h("span", { class: "mono", text: hop.byHost + (hop.byIP ? " (" + hop.byIP + ")" : "") }), hop.proto ? h("span", { class: "muted", text: " with " + hop.proto + (hop.auth ? " (authenticated)" : "") }) : null]) : null,
          hop.flags.length ? h("div", { class: "hop-flag", text: hop.flags.join(" · ") }) : null
        ])
      ]);
      flow.appendChild(node);
    });
    return flow;
  }

  function routingDialog(r) {
    var close = h("button", { class: "icon-btn", type: "button", "aria-label": "Close", title: "Close" }, icon("x"));
    var dlg = h("dialog", { class: "modal", "aria-labelledby": "rt-title" }, h("div", { class: "modal-in" }, [
      h("div", { class: "modal-h" }, [h("span", { class: "card-ic ci-routing" }, icon("route")), h("div", { class: "card-t" }, [h("h3", { id: "rt-title", text: "Routing path · full details" }), h("p", { text: r.routing.hops.length + " hops, earliest first · times in UTC" })]), close]),
      h("div", { class: "modal-b" }, routingFull(r))
    ]));
    close.addEventListener("click", function () { dlg.close(); });
    // Clicking the dimmed area outside the panel closes it.
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    return dlg;
  }


  // ---------- 2. Identity ----------
  function identity(r) {
    var I = r.identity;
    function addr(a) { return a ? (a.display ? a.display + " <" + a.address + ">" : a.address) : ""; }
    var rows = h("div", { class: "kvs" }, [kv("From", addr(I.from)), kv("Reply-To", addr(I.replyTo)), kv("Sender", addr(I.sender)), kv("Return-Path", addr(I.returnPath)), kv("X-Sender-IP", I.senderIP)]);
    var grid = h("div", { class: "matrix", role: "list", "aria-label": "Domain match checks" }, I.matrix.map(function (m) {
      var t = m.state === "ok" ? "Match" : m.state === "na" ? "Not present" : "Mismatch";
      return h("div", { class: "mx mx-" + m.state, role: "listitem", title: m.a ? m.a + " vs " + m.b : "" }, [h("span", { class: "mx-l", text: m.label }), h("span", { class: "mx-v" }, [icon(m.state === "ok" ? "check" : m.state === "na" ? "minus" : "x"), t])]);
    }));
    return h("div", null, [rows, h("p", { class: "sub-l", text: "Domain match checks" }), grid]);
  }

  // ---------- 3. Authentication ----------
  function auth(r) {
    var checks = r.auth.checks;
    var counts = { pass: 0, fail: 0, warn: 0, none: 0 };
    checks.forEach(function (c) { counts[c.state]++; });
    var order = ["pass", "fail", "warn", "none"], total = checks.length, R = 46, C = 2 * Math.PI * R, off = 0, gap = total > 1 ? 3 : 0;
    var donut = s("svg", { viewBox: "0 0 120 120", class: "donut", role: "img", "aria-label": counts.pass + " of " + total + " checks passed" });
    donut.appendChild(s("circle", { cx: 60, cy: 60, r: R, fill: "none", class: "donut-bg", "stroke-width": 14 }));
    order.forEach(function (k) {
      if (!counts[k]) return;
      var len = C * counts[k] / total;
      var seg = s("circle", { cx: 60, cy: 60, r: R, fill: "none", class: "seg seg-" + k, "stroke-width": 14, "stroke-dasharray": Math.max(len - gap, 1).toFixed(2) + " " + C.toFixed(2), "stroke-dashoffset": (-off).toFixed(2), transform: "rotate(-90 60 60)" }, s("title", { text: STATE[k].label + ": " + counts[k] }));
      donut.appendChild(seg); off += len;
    });
    donut.appendChild(s("text", { x: 60, y: 60, "text-anchor": "middle", class: "donut-num", text: counts.pass + "/" + total }));
    donut.appendChild(s("text", { x: 60, y: 76, "text-anchor": "middle", class: "donut-sub", text: "passed" }));
    var list = h("ul", { class: "checks" }, checks.map(function (c) {
      var st = STATE[c.state];
      return h("li", null, [
        h("span", { class: "ck-k", text: c.key }),
        h("span", { class: "pill pill-" + (c.state === "pass" ? "good" : c.state === "fail" ? "bad" : c.state === "warn" ? "warn" : "neutral") }, [icon(st.icon), c.result === "none" ? "Not checked" : c.result]),
        h("span", { class: "ck-d", title: c.detail, text: c.detail + (c.aligned === true ? " · aligned" : c.aligned === false ? " · not aligned" : "") })
      ]);
    }));
    var sigs = r.auth.dkimSigs.length ? h("p", { class: "note" }, ["DKIM-Signature: ", h("span", { class: "mono", text: r.auth.dkimSigs.map(function (d) { return "d=" + d.d + " s=" + d.s + (d.a ? " " + d.a : ""); }).join(" · ") })]) : null;
    var legend = h("div", { class: "legend" }, order.filter(function (k) { return counts[k]; }).map(function (k) { return h("span", null, [h("i", { class: "lg seg-bg-" + k }), STATE[k].label + " " + counts[k]]); }));
    return h("div", null, [h("div", { class: "auth-wrap" }, [h("div", { class: "donut-box" }, [donut, legend]), list]), sigs]);
  }

  // ---------- 4. Metadata ----------
  function metadata(r) {
    var M = r.metadata;
    var grid = h("div", { class: "kvs two" }, [kv("Subject", M.subject), kv("Date", M.date), kv("Message-ID", M.messageId), kv("MIME-Version", M.mime), kv("Content-Type", M.contentType), kv("Content-Transfer-Encoding", M.cte)]);
    var pts = [["Sent", M.sentAt, "Date header"], ["Received", M.firstAt, "First server"], ["Delivered", M.lastAt, "Mailbox"]].filter(function (p) { return p[1] !== null && p[1] !== undefined; });
    var tl = h("div", { class: "timeline" });
    if (pts.length >= 2) {
      var t0 = Math.min.apply(null, pts.map(function (p) { return p[1]; })), t1 = Math.max.apply(null, pts.map(function (p) { return p[1]; }));
      var span = Math.max(t1 - t0, 1);
      var track = h("div", { class: "tl-track" });
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1][1], b = pts[i][1], dur = (b - a) / 1000;
        var seg = h("div", { class: "tl-seg " + (dur < -600 ? "tl-bad" : dur > 3600 ? "tl-bad" : dur > 600 ? "tl-warn" : "tl-ok"), title: pts[i - 1][0] + " to " + pts[i][0] + ": " + (dur < 0 ? "−" : "") + HL.fmtDur(dur) });
        var l = (Math.min(a, b) - t0) / span * 100, w = Math.abs(b - a) / span * 100;
        seg.style.left = l + "%"; seg.style.width = Math.max(w, 0.8) + "%";
        track.appendChild(seg);
      }
      pts.forEach(function (p, idx) {
        var m = h("span", { class: "tl-dot tl-m" + idx, title: p[0] + " " + fmtTime(p[1]) }, h("span", { text: String(idx + 1) }));
        m.style.left = ((p[1] - t0) / span * 100) + "%";
        track.appendChild(m);
      });
      tl.appendChild(track);
      tl.appendChild(h("ol", { class: "tl-legend" }, pts.map(function (p, idx) {
        var dur = idx ? (p[1] - pts[idx - 1][1]) / 1000 : null;
        return h("li", { class: "tl-m" + idx }, [h("span", { class: "tl-num", text: String(idx + 1) }), h("div", null, [h("strong", { text: p[0] }), h("span", { class: "mono", text: fmtClock(p[1]) }), h("span", { class: "muted", text: p[2] + (dur === null ? "" : " · " + (dur < 0 ? "−" : "+") + HL.fmtDur(dur)) })])]);
      })));
      var total = (t1 - t0) / 1000;
      tl.appendChild(h("p", { class: "note" }, ["Total transit ", h("strong", { text: HL.fmtDur(total) }), " · times in UTC · " + fmtTime(t0).slice(0, 10)]));
    } else tl.appendChild(h("p", { class: "empty", text: "Not enough timestamps to draw a timeline." }));
    return h("div", null, [grid, h("p", { class: "sub-l", text: "Timeline" }), tl]);
  }

  // ---------- 5. Geolocation ----------
  function ipStatus(ip) {
    if (!ip.kind) return { k: "neutral", t: "Unknown" };
    if (!ip.kind.public) return { k: "neutral", t: ip.kind.label || "Private" };
    var g = ip.geo;
    if (!g) return { k: "neutral", t: "No offline data" };
    if (g.threats.length) return { k: "bad", t: "Listed: " + g.threats.join(", ") };
    if (g.asnType === "hosting") return { k: "warn", t: "Hosting network" };
    if (g.asnType === "mail") return { k: "good", t: "Known mail provider" };
    return { k: "neutral", t: "Not listed" };
  }
  function geo(r) {
    var W = root.HL_WORLD, ips = r.geo.ips;
    var pins = {};
    ips.forEach(function (ip) {
      if (!ip.geo || !ip.geo.cc) return;
      var st = ipStatus(ip).k, rank = { bad: 3, warn: 2, good: 1, neutral: 0 };
      var p = pins[ip.geo.cc] || (pins[ip.geo.cc] = { st: st, ips: [] });
      if (rank[st] > rank[p.st]) p.st = st;
      p.ips.push(ip.ip + " (" + ip.roles.join(", ") + ")");
    });
    var map = null;
    if (W) {
      map = s("svg", { viewBox: "0 0 " + W.w + " " + W.h, class: "map", role: "img", "aria-label": "World map with " + Object.keys(pins).length + " pinned countries" });
      map.appendChild(s("path", { d: W.sphere, class: "map-sea" }));
      Object.keys(W.c).forEach(function (cc) { if (W.c[cc].d) map.appendChild(s("path", { d: W.c[cc].d, class: "map-land" + (pins[cc] ? " map-hit map-hit-" + pins[cc].st : "") }, s("title", { text: W.c[cc].n }))); });
      Object.keys(pins).forEach(function (cc) {
        var c = W.c[cc]; if (!c) return;
        var p = pins[cc];
        map.appendChild(s("g", { class: "pin pin-" + p.st, transform: "translate(" + c.x + " " + c.y + ")" }, [
          s("circle", { r: 16, class: "pin-halo" }), s("circle", { r: 6.5, class: "pin-dot" }),
          s("text", { x: c.x > W.w * 0.82 ? -12 : 12, y: 4, "text-anchor": c.x > W.w * 0.82 ? "end" : "start", class: "pin-label", text: W.names[cc] || c.n || cc }),
          s("title", { text: (W.names[cc] || cc) + "\n" + p.ips.join("\n") })
        ]));
      });
    }
    var rows = ips.length ? h("div", { class: "iptable", role: "table", "aria-label": "IP addresses" }, [h("div", { class: "ipr iph", role: "row" }, ["IP address", "Role", "Location / network", "Reputation"].map(function (t) { return h("span", { role: "columnheader", text: t }); }))].concat(ips.map(function (ip) {
      var st = ipStatus(ip), g = ip.geo;
      return h("div", { class: "ipr", role: "row" }, [
        h("span", { class: "mono", role: "cell", title: ip.ip }, breakable(ip.ip)),
        h("span", { role: "cell", class: "muted", title: ip.roles.join(", "), text: ip.roles.join(", ") }),
        h("span", { role: "cell", title: g ? (g.asn ? "AS" + g.asn + " " + g.asnName : "") : "" }, g ? [g.country || "Unknown", h("span", { class: "muted mono", text: g.asn ? " · AS" + g.asn + " " + g.asnName.split(" ")[0] : "" })] : (ip.kind && !ip.kind.public ? "Internal network" : "—")),
        h("span", { role: "cell" }, pill(st.k, st.t))
      ]);
    }))) : h("p", { class: "empty", text: "No IP addresses found in the headers." });
    var info = root.HLGeo && root.HLGeo.info();
    var src = info ? "Offline lookup. IP data " + info.built + (info.lists.length ? " · threat lists " + info.threatBuilt + " (" + info.lists.join(", ") + ")" : "") : "Offline IP data not loaded.";
    return h("div", null, [map, rows, h("p", { class: "note", text: src })]);
  }

  // ---------- 6. Security ----------
  function security(r) {
    var c = r.security.counts, max = Math.max(1, c.tls, c.plain, c.internal, c.unknown);
    var bars = [["Encrypted (TLS)", c.tls, "b-good"], ["Unencrypted", c.plain, "b-bad"], ["Internal handoff", c.internal, "b-int"], ["Not stated", c.unknown, "b-neutral"]];
    var chart = h("div", { class: "bars", role: "img", "aria-label": bars.map(function (b) { return b[0] + " " + b[1]; }).join(", ") }, bars.map(function (b) {
      var fill = h("span", { class: "bar-fill " + b[2], title: b[0] + ": " + b[1] + " hop" + (b[1] === 1 ? "" : "s") });
      fill.style.width = (b[1] / max * 100) + "%";
      return h("div", { class: "bar" }, [h("span", { class: "bar-l", text: b[0] }), h("span", { class: "bar-t" }, fill), h("span", { class: "bar-n", text: String(b[1]) })]);
    }));
    var tlsHops = r.routing.hops.filter(function (x) { return x.tlsVer || x.cipher; });
    var versions = tlsHops.length ? h("p", { class: "note" }, ["Negotiated: ", h("span", { class: "mono", text: tlsHops.map(function (x) { return "hop " + x.n + " " + (x.tlsVer || "TLS") + (x.cipher ? " " + x.cipher.replace(/^TLS_/, "") : ""); }).join(" · ") })]) : null;
    var S = r.security;
    var authAs = S.authAs ? h("span", { class: "v-inline" }, [S.authAs, " ", pill(/anonymous/i.test(S.authAs) ? "neutral" : "good", /anonymous/i.test(S.authAs) ? "External, unauthenticated" : "Authenticated")]) : null;
    return h("div", null, [chart, versions, h("div", { class: "kvs" }, [kv("CrossTenant-AuthAs", S.authAs ? " " : "", authAs), kv("CrossTenant-AuthSource", S.authSource), kv("From entity", S.fromEntity), kv("Direction", S.direction)])]);
  }

  // ---------- 7. Anti-malware / anti-spam ----------
  function gauge(label, val, min, max, bands, note) {
    var g = h("div", { class: "gauge" });
    var head = h("div", { class: "g-h" }, [h("span", { text: label }), h("strong", { class: val === null ? "muted" : "", text: val === null ? "Not present" : String(val) + " / " + max })]);
    var track = h("div", { class: "g-track", role: "img", "aria-label": label + (val === null ? " not present" : " " + val + " of " + max) });
    bands.forEach(function (b) { var z = h("span", { class: "g-band " + b[2] }); z.style.left = ((b[0] - min) / (max - min + 1) * 100) + "%"; z.style.width = ((b[1] - b[0] + 1) / (max - min + 1) * 100) + "%"; track.appendChild(z); });
    if (val !== null) {
      var band = bands.filter(function (b) { return val >= b[0] && val <= b[1]; })[0];
      var mk = h("span", { class: "g-mark " + (band ? band[2] : "") }); mk.style.left = ((val - min + 0.5) / (max - min + 1) * 100) + "%"; track.appendChild(mk);
    }
    g.appendChild(head); g.appendChild(track);
    if (note) g.appendChild(h("p", { class: "g-note", text: note }));
    return g;
  }
  function antispam(r) {
    var A = r.antispam;
    var avKind = A.av.verdict === "malware" ? "bad" : A.av.verdict === "clean" ? "good" : "neutral";
    var avText = A.av.verdict === "malware" ? "Malware flagged" : A.av.verdict === "clean" ? "Scanned, clean" : "No scan result in headers";
    var spy = A.cat === "MALW" ? pill("bad", "Spyware / adware: flagged", "alert") : pill("neutral", "Spyware / adware: no flag");
    var verdicts = h("div", { class: "chips" }, [pill(avKind, "AV: " + avText, avKind === "good" ? "check" : avKind === "bad" ? "alert" : null), spy, A.cat ? pill(/PHSH|SPOOF|MALW|IMP|INTOS/.test(A.cat) ? "bad" : /SPM/.test(A.cat) ? "warn" : A.cat === "NONE" ? "good" : "neutral", "Category: " + (A.catLabel || A.cat)) : null]);
    var gauges = h("div", { class: "gauges" }, [
      gauge("SCL · spam confidence", A.scl, -1, 9, [[-1, -1, "z-int"], [0, 1, "z-good"], [2, 4, "z-low"], [5, 6, "z-warn"], [7, 9, "z-bad"]], A.scl === -1 ? "Filtering bypassed by an allow rule" : A.scl !== null ? (A.scl >= 7 ? "High confidence spam" : A.scl >= 5 ? "Spam" : "Not spam") : ""),
      gauge("PCL · phishing confidence", A.pcl, 0, 8, [[0, 3, "z-good"], [4, 8, "z-bad"]], A.pcl !== null ? (A.pcl >= 4 ? "Likely phishing content" : "Low phishing likelihood") : ""),
      gauge("BCL · bulk complaint level", A.bcl, 0, 9, [[0, 0, "z-good"], [1, 3, "z-low"], [4, 7, "z-warn"], [8, 9, "z-bad"]], A.bcl !== null ? (A.bcl >= 8 ? "Bulk sender with many complaints" : A.bcl >= 4 ? "Bulk sender" : "Not bulk") : "")
    ]);
    var rows = [];
    if (A.sfv) rows.push(kv("SFV · filter verdict", A.sfv + (A.sfvLabel ? " · " + A.sfvLabel : "")));
    if (A.sfty) rows.push(kv("SFTY · safety tip", A.sfty + (A.sftyLabel ? " · " + A.sftyLabel : "")));
    if (A.ctry) rows.push(kv("CTRY · source country", A.ctry));
    if (A.lang) rows.push(kv("LANG", A.lang));
    if (A.ptr) rows.push(kv("PTR · reverse DNS", A.ptr === "InfoNoRecords" ? "No record" : A.ptr));
    if (A.helo) rows.push(kv("H · HELO name", A.helo));
    if (A.dest) rows.push(kv("Delivered to folder", A.dest === "J" ? "Junk" : A.dest === "I" ? "Inbox" : A.dest));
    var pp = A.proofpoint;
    if (pp && Object.keys(pp).length) rows.push(kv("Proofpoint", ["spamscore", "phishscore", "malwarescore", "bulkscore"].filter(function (k) { return pp[k] !== undefined; }).map(function (k) { return k.replace("score", "") + " " + pp[k]; }).join(" · ")));
    if (A.mimecast !== null) rows.push(kv("Mimecast spam score", String(A.mimecast)));
    if (A.spamassassin) rows.push(kv("SpamAssassin", A.spamassassin.flag + (A.spamassassin.score !== null ? " · score " + A.spamassassin.score : "")));
    var empty = !A.hasMs && !rows.length ? h("p", { class: "empty", text: "No Exchange Online or gateway filtering headers found. These appear when the message passes through Microsoft 365, Proofpoint, Mimecast or SpamAssassin." }) : null;
    return h("div", null, [verdicts, A.hasMs ? gauges : null, rows.length ? h("div", { class: "kvs" }, rows) : null, empty]);
  }

  // ---------- 8. Custom headers ----------
  function custom(r) {
    var C = r.custom;
    function idv(v, ok) { return v ? h("span", { class: "v-inline" }, [h("span", { class: "mono trunc", text: v }), " ", pill(ok ? "good" : "bad", ok ? "Valid format" : "Malformed", ok ? "check" : "x")]) : null; }
    return h("div", { class: "kvs" }, [
      kv("X-Mailer / User-Agent", C.mailer, C.mailerNote ? h("span", { class: "v-note", text: C.mailerNote }) : null),
      kv("X-Originating-Email", C.origEmail ? C.origEmail.address : ""),
      kv("Network-Message-Id", C.networkMessageId ? " " : "", idv(C.networkMessageId, C.nmidValid)),
      kv("CrossTenant-Id", C.tenantId ? " " : "", idv(C.tenantId, C.tenantValid))
    ]);
  }

  // ---------- Raw header pane ----------
  var SECT = [[/^(received|return-path|delivered-to|x-originating-ip|x-original-to)$/, "routing"], [/^(from|reply-to|sender|to|cc|x-sender-ip)$/, "identity"], [/^(authentication-results|received-spf|dkim-signature|arc-|x-ms-exchange-authentication|authentication-results-original)/, "auth"], [/^(message-id|subject|date|mime-version|content-)/, "metadata"], [/(antispam|-scl$|-pcl$|avstamp|spam|virus|proofpoint|mimecast|forefront)/, "malware"], [/(crosstenant-auth|authas|authsource|directionality)/, "security"], [/^x-/, "custom"]];
  function sectOf(name) { name = name.toLowerCase(); for (var i = 0; i < SECT.length; i++) if (SECT[i][0].test(name)) return SECT[i][1]; return "other"; }
  function rawPane(r) {
    var filter = h("input", { type: "search", class: "raw-filter", placeholder: "Filter headers", "aria-label": "Filter headers", autocomplete: "off", spellcheck: "false" });
    var list = h("ol", { class: "raw-list" }, r.headers.map(function (x) {
      return h("li", { class: "raw-row", id: "hdr-" + x.i, "data-s": (x.name + " " + x.value).toLowerCase() }, [h("span", { class: "raw-n" }, [h("i", { class: "sd ci-" + sectOf(x.name) }), x.name]), h("span", { class: "raw-v", text: x.value })]);
    }));
    var count = h("span", { class: "raw-count", text: String(r.headers.length) });
    filter.addEventListener("input", function () {
      var q = filter.value.trim().toLowerCase(), shown = 0;
      Array.prototype.forEach.call(list.children, function (li) { var ok = !q || li.getAttribute("data-s").indexOf(q) > -1; li.classList.toggle("hidden", !ok); if (ok) shown++; });
      count.textContent = q ? shown + " / " + r.headers.length : String(r.headers.length);
    });
    return h("aside", { class: "raw", id: "raw-pane", "aria-label": "Raw headers" }, [
      h("div", { class: "raw-h" }, [h("button", { class: "icon-btn", type: "button", id: "raw-toggle", "aria-expanded": "true", "aria-controls": "raw-body", title: "Collapse raw headers" }, icon("panel")), h("h3", { text: "Raw headers" }), count]),
      h("div", { class: "raw-body", id: "raw-body" }, [h("div", { class: "raw-search" }, [icon("search"), filter]), list])
    ]);
  }

  // ---------- Exports (generated in memory, saved only on click) ----------
  function summary(r) {
    var lines = ["header-lens report", "Verdict: " + r.verdict + " (" + r.score + "/100, " + r.confidence + " confidence)"];
    if (r.identity.from) lines.push("From: " + r.identity.from.raw);
    if (r.metadata.subject) lines.push("Subject: " + r.metadata.subject);
    lines.push("Auth: " + r.auth.checks.map(function (c) { return c.key + "=" + c.result; }).join(", "));
    lines.push("", "Findings:");
    r.findings.forEach(function (f) { lines.push("- [" + f.sev + "] " + f.title + (f.detail ? ": " + f.detail : "")); });
    lines.push("", "IPs:");
    r.geo.ips.forEach(function (ip) { lines.push("- " + ip.ip + " (" + ip.roles.join(", ") + ")" + (ip.geo ? " " + ip.geo.cc + " AS" + ip.geo.asn + " " + ip.geo.asnName : "")); });
    return lines.join("\n");
  }
  function csv(r) {
    var q = function (v) { v = String(v === null || v === undefined ? "" : v); return /^[=+\-@\t\r]/.test(v) ? "\"'" + v.replace(/"/g, "\"\"") + "\"" : "\"" + v.replace(/"/g, "\"\"") + "\""; };
    var rows = [["type", "section", "severity", "name", "value"]];
    r.findings.forEach(function (f) { rows.push(["finding", f.section, f.sev, f.title, f.detail]); });
    r.headers.forEach(function (x) { rows.push(["header", sectOf(x.name), "", x.name, x.value]); });
    return rows.map(function (row) { return row.map(q).join(","); }).join("\r\n");
  }
  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var a = h("a", { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // Image export: draws the dashboard to a canvas in this tab (no network) and opens the PNG in a new tab.
  function svgInline(orig, clone) {
    var props = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-family", "font-size", "font-weight", "paint-order", "stroke-linejoin"];
    var a = orig.querySelectorAll("svg, svg *"), b = clone.querySelectorAll("svg, svg *");
    for (var i = 0; i < a.length && i < b.length; i++) {
      var cs = getComputedStyle(a[i]);
      props.forEach(function (p) { var v = cs.getPropertyValue(p); if (v && v !== "normal") b[i].setAttribute(p, v); });
      if (a[i].tagName.toLowerCase() === "svg") { var r = a[i].getBoundingClientRect(); b[i].setAttribute("width", r.width); b[i].setAttribute("height", r.height); }
    }
  }
  function exportImage(btn, target) {
    if (typeof root.html2canvas !== "function") return;
    var tab = window.open("", "_blank");
    if (tab) { tab.document.title = "header-lens report"; tab.document.body.style.background = "#08111d"; tab.document.body.appendChild(tab.document.createTextNode("Rendering…")); tab.document.body.style.color = "#a9bbcf"; tab.document.body.style.font = "14px sans-serif"; }
    var label = btn.querySelector("span"), old = label.textContent;
    label.textContent = "Rendering…"; btn.disabled = true;
    var stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
    root.html2canvas(target, {
      backgroundColor: "#08111d", scale: Math.min(2, window.devicePixelRatio || 1) * 1.25, logging: false, useCORS: false,
      ignoreElements: function (el) { return el.classList && el.classList.contains("dash-bar"); },
      onclone: function (doc, el) {
        svgInline(target, el);
        var head = doc.createElement("div");
        head.className = "export-head";
        var t = doc.createElement("strong"); t.textContent = "header-lens · email header analysis";
        var m = doc.createElement("span"); m.textContent = "Generated " + stamp + " · Cyber Insight Signals";
        head.appendChild(t); head.appendChild(m);
        el.insertBefore(head, el.firstChild);
        el.classList.add("exporting");
      }
    }).then(function (canvas) {
      canvas.toBlob(function (blob) {
        var url = URL.createObjectURL(blob);
        if (tab && !tab.closed) tab.location.href = url;
        else { var a = h("a", { href: url, download: "header-lens-report.png" }); document.body.appendChild(a); a.click(); a.remove(); }
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      }, "image/png");
    }).catch(function () { if (tab && !tab.closed) tab.close(); }).then(function () { label.textContent = old; btn.disabled = false; });
  }

  // ---------- Render ----------
  function render(container, r, actions) {
    current = r;
    container.textContent = "";
    var F = r.findings;
    var toolbar = h("div", { class: "dash-bar" }, [
      h("button", { class: "btn btn-ghost", type: "button", onclick: actions.back }, [icon("back"), "New analysis"]),
      h("div", { class: "dash-actions" }, [
        h("button", { class: "btn btn-ghost", type: "button", onclick: function (e) { var b = e.currentTarget; navigator.clipboard.writeText(summary(r)).then(function () { b.lastChild.textContent = "Copied"; setTimeout(function () { b.lastChild.textContent = "Copy summary"; }, 1500); }, function () {}); } }, [icon("copy"), h("span", { text: "Copy summary" })]),
        h("button", { class: "btn btn-ghost", type: "button", onclick: function () { download("header-lens-report.csv", csv(r), "text/csv"); } }, [icon("download"), "Export CSV"]),
        h("button", { class: "btn btn-ghost", type: "button", onclick: function (e) { exportImage(e.currentTarget, main); } }, [icon("image"), h("span", { text: "Export image" })])
      ])
    ]);
    var cards = h("div", { class: "cards" }, [
      card("1", "routing", "Routing path", "route", r.routing.hops.length + " hop" + (r.routing.hops.length === 1 ? "" : "s") + ", earliest first", F, routing(r), true,
        r.routing.hops.length ? h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: function () { dlg.showModal(); } }, [icon("expand"), "View full details"]) : null),
      card("2", "identity", "Sender identity", "user", "Who the message claims to be from", F, identity(r)),
      card("3", "auth", "Authentication", "shield", "SPF, DKIM, DMARC, ARC", F, auth(r)),
      card("4", "metadata", "Message metadata", "file", "Message details and delivery timeline", F, metadata(r), true),
      card("5", "geo", "IP geolocation and reputation", "globe", "Public IPs from the headers", F, geo(r), "span-wide"),
      card("6", "security", "Security and encryption", "lock", "Transport encryption per hop", F, security(r), "span-narrow"),
      card("7", "malware", "Anti-malware and anti-spam", "bug", "Gateway and Exchange Online verdicts", F, antispam(r)),
      card("8", "custom", "Custom headers", "code", "Client and Exchange identifiers", F, custom(r))
    ]);
    var dlg = routingDialog(r);
    var main = h("div", { class: "dash-main" }, [toolbar, verdict(r), cards, dlg]);
    var pane = rawPane(r);
    var layout = h("div", { class: "dash-layout" }, [main, pane]);
    container.appendChild(layout);

    var toggle = pane.querySelector("#raw-toggle");
    function setOpen(open) {
      layout.classList.toggle("raw-closed", !open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("title", open ? "Collapse raw headers" : "Show raw headers");
    }
    toggle.addEventListener("click", function () { setOpen(layout.classList.contains("raw-closed")); });
    setOpen(false);
    onJump = function (idx) {
      setOpen(true);
      var row = document.getElementById("hdr-" + idx);
      if (!row) return;
      var f = pane.querySelector(".raw-filter"); if (f.value) { f.value = ""; f.dispatchEvent(new Event("input")); }
      Array.prototype.forEach.call(pane.querySelectorAll(".raw-row.hl"), function (x) { x.classList.remove("hl"); });
      row.classList.add("hl");
      row.scrollIntoView({ block: "center", behavior: "smooth" });
    };
  }

  function clear(container) { current = null; onJump = null; if (container) container.textContent = ""; }

  root.HLDash = { render: render, clear: clear };
})(typeof globalThis !== "undefined" ? globalThis : this);

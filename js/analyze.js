// header-lens analysis engine. Pure functions: no DOM, no network, no storage.
// Input: raw header text. Output: a plain object the dashboard renders.
(function (root) {
  "use strict";

  // ---------- Parsing ----------
  function headerBlock(text) {
    var t = String(text || "").replace(/\r\n?/g, "\n").replace(/^﻿/, "").replace(/^\s+/, "");
    var end = t.search(/\n[ \t]*\n/);
    return end === -1 ? t : t.slice(0, end);
  }

  function parse(text) {
    var out = [];
    headerBlock(text).split("\n").forEach(function (line) {
      if (/^[ \t]/.test(line) && out.length) { out[out.length - 1].value += " " + line.trim(); return; }
      var m = line.match(/^([!-9;-~]+):[ \t]?(.*)$/);
      if (m) out.push({ i: out.length, name: m[1], lname: m[1].toLowerCase(), value: m[2].trim() });
    });
    return out;
  }

  function Headers(list) {
    this.list = list;
    this.all = function (n) { n = n.toLowerCase(); return list.filter(function (h) { return h.lname === n; }); };
    this.get = function (n) { var a = this.all(n); return a.length ? a[0] : null; };
    this.val = function (n) { var h = this.get(n); return h ? h.value : ""; };
  }

  // RFC 2047 encoded words (=?UTF-8?B?...?= / =?UTF-8?Q?...?=)
  function decodeWords(s) {
    if (!s || s.indexOf("=?") === -1) return s;
    return s.replace(/(=\?[^?]+\?[bBqQ]\?[^?]*\?=)\s+(?==\?)/g, "$1").replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, function (all, cs, enc, data) {
      try {
        var bytes;
        if (enc.toUpperCase() === "B") {
          var bin = atobSafe(data);
          bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } else {
          var q = data.replace(/_/g, " "), arr = [];
          for (var j = 0; j < q.length; j++) {
            if (q[j] === "=" && /^[0-9A-Fa-f]{2}$/.test(q.substr(j + 1, 2))) { arr.push(parseInt(q.substr(j + 1, 2), 16)); j += 2; }
            else arr.push(q.charCodeAt(j));
          }
          bytes = new Uint8Array(arr);
        }
        return new TextDecoder(cs.replace(/\*.*$/, "")).decode(bytes);
      } catch (e) { return all; }
    });
  }
  function atobSafe(s) { return typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary"); }

  function parseDate(s) {
    if (!s) return null;
    var t = s.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    t = t.replace(/^([A-Za-z]{3}),?\s*/, "$1, ");
    var d = Date.parse(t);
    if (isNaN(d)) {
      var m = t.match(/(\d{1,2}) ([A-Za-z]{3}) (\d{4}) (\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?) ?([+-]\d{4}|[A-Z]{1,5})?/);
      if (m) d = Date.parse(m[1] + " " + m[2] + " " + m[3] + " " + m[4].replace(/\.\d+$/, "") + " " + (m[5] || "+0000"));
    }
    return isNaN(d) ? null : d;
  }

  // ---------- Addresses and domains ----------
  function parseAddress(v) {
    v = decodeWords(v || "").trim();
    if (!v) return null;
    var m = v.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+?)\s*>/);
    var display = "", addr = "";
    if (m) { display = m[1].trim().replace(/^"|"$/g, "").trim(); addr = m[2]; }
    else { var m2 = v.match(/([^\s<>"(),;:]+@[^\s<>"(),;:]+)/); addr = m2 ? m2[1] : v; }
    addr = addr.replace(/^mailto:/i, "").toLowerCase();
    var at = addr.lastIndexOf("@");
    return { raw: v, display: display, address: addr, domain: at > -1 ? addr.slice(at + 1).replace(/[>.]+$/, "") : "" };
  }

  // Two-level public suffixes where the registrable domain is three labels.
  var SL = /\.(co|com|net|org|gov|ac|edu|ltd|plc|nic|res|or|ne|go|gob|mil|nhs|police|sch)\.[a-z]{2}$/;
  function orgDomain(d) {
    d = (d || "").toLowerCase().replace(/\.$/, "");
    var p = d.split(".");
    if (p.length <= 2) return d;
    return SL.test(d) ? p.slice(-3).join(".") : p.slice(-2).join(".");
  }

  var FREEMAIL = ["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "ymail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mail.com", "gmx.com", "gmx.net", "gmx.de", "web.de", "proton.me", "protonmail.com", "zoho.com", "yandex.com", "yandex.ru", "mail.ru", "qq.com", "163.com", "126.com", "rediffmail.com", "tutanota.com", "tuta.io", "inbox.com", "fastmail.com", "hushmail.com"];
  function isFree(d) { return FREEMAIL.indexOf(orgDomain(d)) > -1; }

  function skeleton(d) {
    return orgDomain(d).replace(/\.[^.]+$/, "").replace(/rn/g, "m").replace(/vv/g, "w").replace(/[0]/g, "o").replace(/[1|!]/g, "l").replace(/[3]/g, "e").replace(/[5]/g, "s").replace(/[@]/g, "a").replace(/-/g, "");
  }
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    var dp = []; for (var i = 0; i <= a.length; i++) { dp[i] = [i]; }
    for (var j = 1; j <= b.length; j++) dp[0][j] = j;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
  }
  function lookalike(a, b) {
    var oa = orgDomain(a), ob = orgDomain(b);
    if (!oa || !ob || oa === ob) return false;
    var sa = skeleton(oa), sb = skeleton(ob);
    if (sa.length < 4) return false;
    return sa === sb || editDistance(oa.replace(/\.[^.]+$/, ""), ob.replace(/\.[^.]+$/, "")) <= 1;
  }

  // ---------- IP helpers ----------
  var V4 = /\b((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})\b/;
  var V6 = /(?:IPv6:)?((?:[0-9a-fA-F]{1,4}:){2,7}(?::|[0-9a-fA-F]{1,4})|(?:[0-9a-fA-F]{1,4}:){1,6}:(?:[0-9a-fA-F]{1,4}:?){0,6}[0-9a-fA-F]{0,4})/;
  function firstIP(s) {
    if (!s) return "";
    var mapped = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/i);
    if (mapped) return mapped[1];
    var best = "", bestAt = Infinity;
    var m4 = s.match(V4);
    if (m4) { best = m4[1]; bestAt = m4.index; }
    var re = /(?:IPv6:)?([0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,7}(?::\d+\.\d+\.\d+\.\d+)?)/g, m;
    while ((m = re.exec(s))) {
      var c = m[1];
      if (/^::ffff:\d/i.test(c)) { if (m.index < bestAt) { best = c; bestAt = m.index; } break; }
      if (s.charAt(m.index + m[0].length) === ".") continue;
      if (c.split(":").length >= 3 && v6groups(c) && m.index < bestAt) { best = c; bestAt = m.index; break; }
    }
    return best ? cleanIP(best) : "";
  }
  function cleanIP(ip) { var m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); return m ? m[1] : ip.toLowerCase(); }
  function v4num(ip) { var p = ip.split("."); return ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + +p[3]; }
  function v6groups(ip) {
    if (ip.indexOf(".") > -1) return null;
    var parts = ip.split("::");
    if (parts.length > 2) return null;
    var head = parts[0] ? parts[0].split(":") : [], tail = parts.length > 1 && parts[1] ? parts[1].split(":") : [];
    var fill = 8 - head.length - tail.length;
    if (fill < 0 || (parts.length === 1 && fill !== 0)) return null;
    var g = head.concat(new Array(parts.length > 1 ? fill : 0).fill("0"), tail).map(function (x) { return parseInt(x || "0", 16); });
    return g.length === 8 && g.every(function (x) { return x >= 0 && x <= 0xffff; }) ? g : null;
  }
  var V4_PRIVATE = [["0.0.0.0", 8, "This network"], ["10.0.0.0", 8, "Private"], ["100.64.0.0", 10, "Carrier NAT"], ["127.0.0.0", 8, "Loopback"], ["169.254.0.0", 16, "Link-local"], ["172.16.0.0", 12, "Private"], ["192.0.0.0", 24, "Reserved"], ["192.0.2.0", 24, "Documentation"], ["192.168.0.0", 16, "Private"], ["198.18.0.0", 15, "Benchmarking"], ["198.51.100.0", 24, "Documentation"], ["203.0.113.0", 24, "Documentation"], ["224.0.0.0", 4, "Multicast"], ["240.0.0.0", 4, "Reserved"]];
  function ipKind(ip) {
    if (!ip) return null;
    if (ip.indexOf(":") === -1) {
      var n = v4num(ip);
      for (var i = 0; i < V4_PRIVATE.length; i++) {
        var r = V4_PRIVATE[i], base = v4num(r[0]), mask = r[1] === 0 ? 0 : (~0 << (32 - r[1])) >>> 0;
        if (((n & mask) >>> 0) === base) return { v: 4, n: n, public: false, label: r[2] };
      }
      return { v: 4, n: n, public: true };
    }
    var g = v6groups(ip);
    if (!g) return { v: 6, public: false, label: "Unparsed" };
    var top48 = g[0] * 4294967296 + g[1] * 65536 + g[2];
    if (g.every(function (x) { return x === 0; })) return { v: 6, public: false, label: "Unspecified" };
    if (g.slice(0, 7).every(function (x) { return x === 0; })) return { v: 6, public: false, label: "Loopback" };
    if ((g[0] & 0xfe00) === 0xfc00) return { v: 6, public: false, label: "Private (ULA)" };
    if ((g[0] & 0xffc0) === 0xfe80) return { v: 6, public: false, label: "Link-local" };
    if (g[0] === 0x2001 && g[1] === 0x0db8) return { v: 6, public: false, label: "Documentation" };
    if ((g[0] & 0xff00) === 0xff00) return { v: 6, public: false, label: "Multicast" };
    return { v: 6, n: top48, public: true };
  }

  // ---------- Received chain ----------
  function parseReceived(h) {
    var v = h.value;
    var semi = v.lastIndexOf(";");
    var body = semi > -1 ? v.slice(0, semi) : v;
    var date = semi > -1 ? parseDate(v.slice(semi + 1)) : null;
    var fromM = body.match(/^\s*from\s+([\s\S]*?)(?=\s+by\s|\s+with\s|\s+id\s|\s+for\s|$)/i);
    var byM = body.match(/\bby\s+([\s\S]*?)(?=\s+with\s|\s+id\s|\s+for\s|\s+via\s|$)/i);
    var withM = body.match(/\bwith\s+(Microsoft SMTP Server(?:\s*\(TLS\))?|[A-Za-z0-9_-]+(?:\s+(?:ESMTPS?A?|SMTP))?)/i);
    var fromClause = fromM ? fromM[1] : "", byClause = byM ? byM[1] : "";
    var fromHost = (fromClause.match(/^([^\s(\[]+)/) || [])[1] || "";
    var rdnsM = fromClause.match(/\(\s*([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\.?\s*[\[(]/i);
    var proto = withM ? withM[1] : "";
    var tlsVer = (body.match(/version=(TLS[0-9_.v]+)/i) || body.match(/\b(TLSv?1(?:\.[0-3]|_[0-3])?)\b/i) || [])[1] || "";
    var cipher = (body.match(/cipher=([A-Z0-9_-]+)/i) || [])[1] || "";
    var P = proto.toUpperCase();
    var tls = "unknown";
    if (/^(ESMTPS|ESMTPSA|LMTPS|UTF8SMTPS|UTF8SMTPSA|SMTPS|ESMTPTLS)$/.test(P.split(" ").pop()) || tlsVer || /using TLS|SMTP Server \(TLS\)/i.test(body)) tls = "tls";
    else if (/^(HTTP|HTTPS|MAPI|LMTP|LOCAL)$/.test(P) || /Microsoft SMTP Server id/i.test(body) || /^(LOCAL|MAILBOX)/i.test(fromHost)) tls = "internal";
    else if (/^(SMTP|ESMTP|ESMTPA|UTF8SMTP)$/.test(P.split(" ").pop()) || /Microsoft SMTP Server$/i.test(proto)) tls = "plain";
    var ip = firstIP(fromClause);
    var ipk = ipKind(ip);
    if (/Microsoft SMTP Server/i.test(body) && !tlsVer && tls !== "tls") tls = ipk && ipk.public && !/^2603:10|^2a01:111:/i.test(ip) ? "plain" : "internal";
    if (!fromClause && !ip) tls = "internal";
    if (tls === "plain" && ipk && !ipk.public) tls = "internal";
    return {
      raw: v, headerIndex: h.i, fromHost: fromHost, rdns: rdnsM ? rdnsM[1].toLowerCase() : "", ip: ip,
      byHost: (byClause.match(/^([^\s(\[;]+)/) || [])[1] || "", byIP: firstIP(byClause),
      proto: proto, tls: tls, tlsVer: tlsVer.replace(/_/g, ".").replace(/^TLSV/i, "TLS"), cipher: cipher,
      auth: /^(ESMTPSA|ESMTPA|UTF8SMTPSA)$/.test(P.split(" ").pop()), date: date,
      providerInternal: (function () { var a = family(fromHost), b = family((byClause.match(/^([^\s(\[;]+)/) || [])[1]); return !!a && a === b; })(),
      unknownRdns: /\bunknown\b/i.test(fromClause), heloIsIP: V4.test(fromHost) || /^\[/.test(fromHost)
    };
  }

  function family(host) {
    host = (host || "").toLowerCase();
    if (/(^|\.)(outlook\.com|office365\.com|exchangelabs\.com|microsoft\.com|bigfish\.com|frontbridge\.com|messaging\.microsoft\.com)$/.test(host) || /^(mail\d+-[a-z]{2,4}\d*|[a-z]{2,4}\d?ehs[a-z]{2,4}\d+)$/i.test(host)) return "microsoft";
    if (/(^|\.)(google\.com|gmail\.com|googlemail\.com)$/.test(host)) return "google";
    if (/(^|\.)(pphosted\.com|ppe-hosted\.com)$/.test(host)) return "proofpoint";
    if (/(^|\.)mimecast\.com$/.test(host)) return "mimecast";
    return "";
  }

  // ---------- Authentication ----------
  function parseAuthResults(v) {
    var r = { raw: v, spf: null, dkim: [], dmarc: null, compauth: null, arc: null, server: "", spfIP: "" };
    var parts = v.split(";");
    if (parts.length && !/=/.test(parts[0])) r.server = parts.shift().trim();
    parts.forEach(function (p) {
      p = p.trim();
      var m = p.match(/^(spf|dkim|dmarc|compauth|arc|dkim-atps|bimi|auth)\s*=\s*([a-z]+)/i);
      if (!m) return;
      var k = m[1].toLowerCase(), res = m[2].toLowerCase();
      var prop = function (name) { var x = p.match(new RegExp("(?:^|\\s)" + name.replace(/\./g, "\\.") + "=([^\\s;()]+)", "i")); return x ? x[1].replace(/^"|"$/g, "").toLowerCase() : ""; };
      if (k === "spf") { r.spf = { result: res, mailfrom: prop("smtp.mailfrom"), helo: prop("smtp.helo") }; var ipm = p.match(/sender IP is ([0-9a-f.:]+)/i) || p.match(/client-ip=([0-9a-f.:]+)/i); if (ipm) r.spfIP = cleanIP(ipm[1]); }
      else if (k === "dkim") r.dkim.push({ result: res, d: prop("header.d") || (prop("header.i").split("@")[1] || ""), s: prop("header.s") });
      else if (k === "dmarc") r.dmarc = { result: res, action: prop("action"), from: prop("header.from"), policy: prop("p") || prop("policy.dmarc") };
      else if (k === "compauth") r.compauth = { result: res, reason: prop("reason") };
      else if (k === "arc") r.arc = { result: res };
    });
    return r;
  }

  function tagList(v) {
    var o = {};
    // Handles both "k=v" (DKIM, ARC) and "K:V" (Microsoft anti-spam) styles.
    (v || "").split(";").forEach(function (p) {
      var e = p.indexOf("="), c = p.indexOf(":"), i = e === -1 ? c : c === -1 ? e : Math.min(e, c);
      if (i > 0) o[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim();
    });
    return o;
  }

  // Commonly impersonated brands and the registrable domains they really send from.
  var BRANDS = {
    PayPal: ["paypal.com", "paypal.me", "paypal-communication.com"], Microsoft: ["microsoft.com", "office.com", "office365.com", "outlook.com", "live.com", "microsoftonline.com", "sharepoint.com", "onmicrosoft.com", "hotmail.com"],
    Apple: ["apple.com", "icloud.com"], Amazon: ["amazon.com", "amazon.in", "amazon.co.uk", "amazon.de", "amazonses.com", "aws.com"], Google: ["google.com", "gmail.com", "youtube.com", "googlemail.com"],
    DocuSign: ["docusign.com", "docusign.net"], Netflix: ["netflix.com"], DHL: ["dhl.com", "dhl.de"], FedEx: ["fedex.com"], LinkedIn: ["linkedin.com"], Facebook: ["facebook.com", "facebookmail.com", "meta.com"],
    Adobe: ["adobe.com"], Dropbox: ["dropbox.com", "dropboxmail.com"], Wells: ["wellsfargo.com"], Chase: ["chase.com", "jpmorgan.com"], HSBC: ["hsbc.com", "hsbc.co.uk", "hsbc.co.in"], Coinbase: ["coinbase.com"], Binance: ["binance.com"]
  };
  var BRAND_KEYS = { PayPal: "paypal", Microsoft: "microsoft", Apple: "apple", Amazon: "amazon", Google: "google", DocuSign: "docusign", Netflix: "netflix", DHL: "dhl", FedEx: "fedex", LinkedIn: "linkedin", Facebook: "facebook", Adobe: "adobe", Dropbox: "dropbox", Wells: "wellsfargo", Chase: "chasebank", HSBC: "hsbc", Coinbase: "coinbase", Binance: "binance" };
  function brandOwns(b, d) { var o = orgDomain(d); return BRANDS[b].some(function (x) { return o === x || o.slice(-(x.length + 1)) === "." + x; }); }
  function brandSpoof(d) {
    var sk = skeleton(d) + "." + skeleton(d.split(".").slice(0, -2).join(".") || "x");
    for (var b in BRAND_KEYS) if (sk.indexOf(BRAND_KEYS[b]) > -1 && !brandOwns(b, d)) return b === "Wells" ? "Wells Fargo" : b;
    return null;
  }
  function brandInText(t) {
    t = (t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    for (var b in BRAND_KEYS) if (BRAND_KEYS[b].length > 4 && t.indexOf(BRAND_KEYS[b]) > -1) return b;
    return null;
  }

  // ---------- Reference tables ----------
  var CAT = { PHSH: "Phishing", HPHSH: "High confidence phishing", SPOOF: "Spoofing", MALW: "Malware", HSPM: "High confidence spam", SPM: "Spam", BULK: "Bulk", GIMP: "Mailbox intelligence impersonation", UIMP: "User impersonation", DIMP: "Domain impersonation", OSPM: "Outbound spam", INTOS: "Intra-org phishing", AMP: "Anti-malware", FTBP: "File type block", NONE: "None" };
  var SFV = { SPM: "Marked as spam by filtering", NSPM: "Not spam", SKS: "Marked spam before filtering (rule)", SKA: "Skipped: allowed sender or domain", SKB: "Blocked sender or domain", SKN: "Skipped: marked safe by rule", SKI: "Skipped: intra-org", SKQ: "Released from quarantine", SFE: "Skipped: user safe sender", BLK: "Blocked by user", SKU: "Skipped: unknown reason" };
  var SFTY = { "9.19": "Domain impersonation", "9.20": "User impersonation", "9.25": "First contact safety tip" };
  var RISKY_MAILERS = [[/phpmailer\s*\[?v?(\d+)\.(\d+)/i, function (m) { return +m[1] < 6 ? "PHPMailer " + m[1] + "." + m[2] + " is outdated (known remote code execution flaws before 5.2.18) and common in phishing kits" : "PHPMailer is a scripted mailer often used by phishing kits"; }], [/phpmailer/i, "PHPMailer is a scripted mailer often used by phishing kits"], [/leaf\s*phpmailer|gammadyne|atomic mail|turbo.?mailer|bulk mailer|mass mail|sendblaster|mailking|advanced mass sender/i, "Bulk-sending tool commonly seen in spam and phishing"], [/outlook express|microsoft cdo|the bat!/i, "Very old mail client, rarely used by legitimate senders today"], [/python|perl|curl|swiftmailer|nodemailer/i, "Script or library sender, check it matches the claimed sender"]];

  // Known mail providers (legitimate infrastructure) and generic hosting networks.
  var MAIL_ASN = { 8075: "Microsoft", 15169: "Google", 36647: "Yahoo", 26211: "Proofpoint", 22843: "Proofpoint", 52129: "Proofpoint", 30031: "Mimecast", 42427: "Mimecast", 11377: "SendGrid", 14618: "Amazon", 16509: "Amazon", 54994: "Mailgun", 394299: "Salesforce", 14340: "Salesforce", 27357: "Rackspace", 46606: "Unified Layer", 21342: "Akamai", 2635: "Automattic", 393567: "Postmark", 19994: "Rackspace", 32934: "Facebook", 13414: "Twitter", 40934: "Fortinet", 4766: "KT", 9318: "SK Broadband" };
  var HOSTING_ASN = { 14061: "DigitalOcean", 16276: "OVH", 24940: "Hetzner", 63949: "Akamai Linode", 20473: "Vultr", 51167: "Contabo", 45102: "Alibaba Cloud", 132203: "Tencent Cloud", 31898: "Oracle Cloud", 60781: "LeaseWeb", 16265: "LeaseWeb", 9009: "M247", 36352: "ColoCrossing", 53667: "FranTech", 212238: "Datacamp", 49505: "Selectel", 57523: "Chang Way", 202425: "IP Volume", 211252: "Delis", 44477: "Stark Industries", 399629: "BL Networks", 8100: "QuadraNet", 62904: "Eonix", 40021: "Contabo US", 46664: "VolumeDrive", 35916: "Multacom", 207083: "Quintex", 197540: "netcup", 12876: "Scaleway", 3214: "xTom", 59253: "Leaseweb Asia", 136907: "Huawei Cloud", 55990: "Huawei Cloud", 37963: "Alibaba", 24429: "Alibaba", 133752: "Leaseweb", 22612: "Namecheap", 61317: "Digital Ocean", 398101: "GoDaddy", 26496: "GoDaddy", 47583: "Hostinger", 204915: "Hostinger" };

  // ---------- Main analysis ----------
  function analyze(text, ctx) {
    ctx = ctx || {};
    var lookup = ctx.lookup || function () { return null; };
    var list = parse(text);
    var H = new Headers(list);
    var findings = [];
    function add(section, sev, title, detail, points, header) { findings.push({ section: section, sev: sev, title: title, detail: detail || "", points: points || 0, header: header }); }

    // Identity
    var from = parseAddress(H.val("From")), replyTo = parseAddress(H.val("Reply-To")), sender = parseAddress(H.val("Sender"));
    var returnPath = parseAddress(H.val("Return-Path")), deliveredTo = parseAddress(H.val("Delivered-To")) || parseAddress(H.val("X-Original-To")) || parseAddress(H.val("To"));
    var xOrigEmail = parseAddress(H.val("X-Originating-Email") || H.val("X-Original-Sender"));

    // Authentication
    var arList = H.all("Authentication-Results").map(function (h) { var r = parseAuthResults(h.value); r.headerIndex = h.i; return r; });
    var ar = arList[0] || null; // topmost = added by the final receiving system
    var rspfH = H.get("Received-SPF");
    var rspf = rspfH ? { result: (rspfH.value.match(/^\s*([A-Za-z]+)/) || [])[1].toLowerCase(), ip: cleanIP((rspfH.value.match(/client-ip=([0-9a-fA-F.:]+)/i) || [])[1] || ""), headerIndex: rspfH.i } : null;
    var dkimSigs = H.all("DKIM-Signature").map(function (h) { var t = tagList(h.value); return { d: (t.d || "").toLowerCase(), s: t.s || "", a: t.a || "", headerIndex: h.i }; });
    var arcSeals = H.all("ARC-Seal").map(function (h) { var t = tagList(h.value); return { i: +t.i || 0, cv: (t.cv || "").toLowerCase(), d: (t.d || "").toLowerCase() }; });

    var fromOrg = from ? orgDomain(from.domain) : "";
    var spfRes = ar && ar.spf ? ar.spf.result : (rspf ? rspf.result : "none");
    var spfDomain = (ar && ar.spf && ar.spf.mailfrom ? ar.spf.mailfrom.split("@").pop() : "") || (returnPath ? returnPath.domain : "");
    var dkimRes = ar && ar.dkim.length ? (ar.dkim.some(function (d) { return d.result === "pass"; }) ? "pass" : ar.dkim[0].result) : (dkimSigs.length ? "unverified" : "none");
    var dkimPassDomains = ar ? ar.dkim.filter(function (d) { return d.result === "pass"; }).map(function (d) { return d.d; }) : [];
    var dmarcRes = ar && ar.dmarc ? ar.dmarc.result : "none";
    var compRes = ar && ar.compauth ? ar.compauth.result : "none";
    var arcRes = ar && ar.arc ? ar.arc.result : (arcSeals.length ? (arcSeals.some(function (s) { return s.cv === "fail"; }) ? "fail" : "pass") : "none");
    var dkimAligned = dkimPassDomains.some(function (d) { return orgDomain(d) === fromOrg; });
    var spfAligned = spfRes === "pass" && orgDomain(spfDomain) === fromOrg;

    var checks = [
      { key: "SPF", result: spfRes, detail: spfDomain ? "mail from " + spfDomain : "", aligned: spfRes === "pass" ? spfAligned : null },
      { key: "DKIM", result: dkimRes, detail: dkimPassDomains.length ? "d=" + dkimPassDomains.join(", ") : (dkimSigs[0] ? "d=" + dkimSigs[0].d : ""), aligned: dkimRes === "pass" ? dkimAligned : null },
      { key: "DMARC", result: dmarcRes, detail: ar && ar.dmarc ? [ar.dmarc.action && "action=" + ar.dmarc.action, ar.dmarc.from && "from " + ar.dmarc.from].filter(Boolean).join(" · ") : "" },
      { key: "CompAuth", result: compRes, detail: ar && ar.compauth && ar.compauth.reason ? "reason " + ar.compauth.reason : "" },
      { key: "ARC", result: arcRes, detail: arcSeals.length ? arcSeals.length + " seal" + (arcSeals.length > 1 ? "s" : "") : "" }
    ];
    checks.forEach(function (c) { c.state = /^(pass|bestguesspass)$/.test(c.result) ? "pass" : /^(fail|hardfail|permerror|softfail)$/.test(c.result) ? "fail" : "none"; if (c.result === "softfail") c.state = "warn"; });

    if (dmarcRes === "fail") add("auth", "high", "DMARC failed", "The From domain's own policy rejects this message's authentication.", 25, ar.headerIndex);
    else if (dmarcRes === "pass") add("auth", "good", "DMARC passed", "Authentication aligns with the From domain.", -12, ar.headerIndex);
    if (compRes === "fail") add("auth", "high", "Composite authentication failed", "Microsoft's combined check could not verify the sender.", 15, ar.headerIndex);
    if (/^(fail|hardfail)$/.test(spfRes)) add("auth", "med", "SPF failed", "The sending server isn't authorised by " + (spfDomain || "the envelope domain") + ".", 12, ar ? ar.headerIndex : rspf && rspf.headerIndex);
    else if (spfRes === "softfail") add("auth", "low", "SPF soft fail", "The sending server is probably not authorised to send for " + (spfDomain || "this domain") + ".", 6, ar ? ar.headerIndex : rspf && rspf.headerIndex);
    if (dkimRes === "fail") add("auth", "med", "DKIM signature failed", "The message was altered or the signature is forged.", 10, ar && ar.headerIndex);
    if (dkimRes === "pass" && !dkimAligned && from) add("auth", "low", "DKIM not aligned with From", "Signed by " + dkimPassDomains.join(", ") + ", not " + fromOrg + ".", 4, ar && ar.headerIndex);
    if (!arList.length && !rspf) add("auth", "info", "No authentication results", "These headers carry no SPF, DKIM or DMARC verdicts. They may have been stripped or copied from the sender's side.", 4);

    // Identity mismatches
    var matrix = [];
    function cmp(label, a, b, sev, points, detail, idx) {
      if (!a || !b || !a.domain || !b.domain) { matrix.push({ label: label, state: "na" }); return; }
      var same = orgDomain(a.domain) === orgDomain(b.domain);
      matrix.push({ label: label, state: same ? "ok" : sev === "high" ? "bad" : "warn", a: a.domain, b: b.domain });
      if (!same) add("identity", sev, detail, a.domain + " vs " + b.domain, points, idx);
    }
    if (!from) add("identity", "med", "No From header", "The sender address is missing.", 10);
    var replyFree = replyTo && isFree(replyTo.domain) && from && !isFree(from.domain);
    cmp("From = Reply-To", from, replyTo, "high", replyFree ? 22 : 18, "Replies go to a different domain" + (replyFree ? " (free webmail)" : ""), H.get("Reply-To") && H.get("Reply-To").i);
    var rpOk = dmarcRes === "pass" || dkimAligned;
    cmp("From = Return-Path", from, returnPath, rpOk ? "low" : "med", rpOk ? 2 : 8, "Bounce address uses a different domain", H.get("Return-Path") && H.get("Return-Path").i);
    cmp("From = Sender", from, sender, "low", 3, "Sender header names a different domain", H.get("Sender") && H.get("Sender").i);
    if (from && from.display) {
      var dm = from.display.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
      if (dm && dm[0].toLowerCase() !== from.address) add("identity", "high", "Display name hides a different address", "Shows \"" + dm[0] + "\" but the real address is " + from.address + ".", 20, H.get("From").i);
    }
    var myDomain = deliveredTo ? deliveredTo.domain : "";
    if (from && myDomain && lookalike(from.domain, myDomain)) add("identity", "high", "Lookalike of your domain", from.domain + " imitates " + orgDomain(myDomain) + ".", 30, H.get("From").i);
    var brand = from ? brandSpoof(from.domain) : null;
    if (brand && !(from && myDomain && lookalike(from.domain, myDomain))) add("identity", "high", "Impersonates " + brand, from.domain + " imitates " + brand + " but isn't one of its domains.", 28, H.get("From").i);
    if (from && from.display && !brand) {
      var dBrand = brandInText(from.display);
      if (dBrand && !brandOwns(dBrand, from.domain)) add("identity", "med", "Display name uses the " + dBrand + " brand", "\"" + from.display + "\" sent from " + from.domain + ".", 12, H.get("From").i);
    }
    if (from && /(^|\.)xn--/.test(from.domain)) add("identity", "med", "Internationalised (punycode) domain", from.domain + " may use look-alike characters.", 10, H.get("From").i);
    if (xOrigEmail && from && xOrigEmail.address !== from.address) add("custom", "med", "Originating account differs from From", xOrigEmail.address + " sent as " + from.address + ".", 8);

    // Received chain (chronological: bottom header first)
    var hops = H.all("Received").map(parseReceived).reverse();
    var prevDate = null;
    hops.forEach(function (hop, idx) {
      hop.n = idx + 1;
      hop.kind = ipKind(hop.ip);
      hop.geo = hop.kind && hop.kind.public ? lookup(hop.ip, hop.kind) : null;
      hop.delay = hop.date !== null && prevDate !== null ? Math.round((hop.date - prevDate) / 1000) : null;
      if (hop.date !== null) prevDate = hop.date;
      hop.flags = [];
      if (hop.providerInternal && hop.tls === "plain") hop.tls = "internal";
    });
    var connecting = tagList(H.val("X-Forefront-Antispam-Report")).cip || (ar && ar.spfIP) || (rspf && rspf.ip) || "";
    connecting = connecting ? cleanIP(connecting) : "";
    var xoip = firstIP(H.val("X-Originating-IP")) || firstIP(H.val("X-Sender-IP")) || "";
    // Origin: the earliest public IP in the chain
    var originHop = null;
    for (var oi = 0; oi < hops.length; oi++) if (hops[oi].kind && hops[oi].kind.public) { originHop = hops[oi]; break; }

    var maxDelay = 0, skew = false, heloBad = false;
    hops.forEach(function (hop) {
      if (hop.delay !== null) {
        if (hop.delay < -120) { hop.flags.push("Timestamp earlier than previous hop"); skew = true; }
        if (hop.delay > maxDelay) maxDelay = hop.delay;
        if (hop.delay > 3600) hop.flags.push("Held for " + fmtDur(hop.delay));
      }
      if (hop.kind && hop.kind.public && !hop.providerInternal) {
        if (hop.tls === "plain") hop.flags.push("No encryption on an internet hop");
        if (hop.unknownRdns) hop.flags.push("No reverse DNS");
        if (hop.heloIsIP) hop.flags.push("Greeted with a raw IP");
        else if (hop.fromHost && hop.fromHost.indexOf(".") === -1) hop.flags.push("Greeted as \"" + hop.fromHost + "\", not a domain name");
        var g = hop.geo;
        if (g && g.threats && g.threats.length) hop.flags.push("Listed: " + g.threats.join(", "));
        if (g && g.asnType === "hosting") hop.flags.push("Generic hosting network (" + g.asnLabel + ")");
      }
      hop.suspicious = hop.flags.some(function (f) { return /^(Listed|No reverse|Greeted|Generic hosting|No encryption)/.test(f); });
      if (hop.flags.some(function (f) { return /^Greeted/.test(f); })) heloBad = true;
    });
    var susHops = hops.filter(function (h) { return h.suspicious; });
    if (susHops.length) add("routing", susHops.some(function (h) { return h.geo && h.geo.threats && h.geo.threats.length; }) ? "high" : "med", susHops.length + " suspicious hop" + (susHops.length > 1 ? "s" : ""), susHops.map(function (h) { return "Hop " + h.n + " " + (h.fromHost || h.ip) + ": " + h.flags.join(", "); }).join(". "), 0, susHops[0].headerIndex);
    if (heloBad) add("routing", "med", "Sending machine didn't identify with a domain", "A hop greeted with a bare name or IP, typical of home PCs and bots rather than mail servers.", 8);
    if (skew) add("routing", "low", "Out-of-order timestamps", "A hop is stamped earlier than the one before it. Clock skew, or forged Received lines.", 6);
    if (maxDelay > 3600) add("routing", "low", "Long delivery delay", "One hop held the message for " + fmtDur(maxDelay) + ".", 4);
    var listedHops = hops.filter(function (h) { return h.geo && h.geo.threats && h.geo.threats.length; });
    if (listedHops.length) add("geo", "high", "Relay IP on a threat list", listedHops.map(function (h) { return h.ip + " (" + h.geo.threats.join(", ") + ")"; }).join("; "), 20);
    var plainHops = hops.filter(function (h) { return h.kind && h.kind.public && h.tls === "plain"; });
    if (plainHops.length) add("security", "low", "Unencrypted internet hop", plainHops.length + " hop" + (plainHops.length > 1 ? "s" : "") + " sent without TLS.", 4);
    var oldTls = hops.filter(function (h) { return /TLS1\.[01]$/.test(h.tlsVer); });
    if (oldTls.length) add("security", "low", "Outdated TLS version", oldTls.map(function (h) { return h.tlsVer; }).join(", ") + " is deprecated.", 2);

    // IPs for the geolocation panel
    var ipMap = {};
    function addIP(ip, role) {
      if (!ip) return;
      var k = ipKind(ip);
      if (!ipMap[ip]) ipMap[ip] = { ip: ip, kind: k, roles: [], geo: k && k.public ? lookup(ip, k) : null };
      if (ipMap[ip].roles.indexOf(role) === -1) ipMap[ip].roles.push(role);
    }
    if (originHop) addIP(originHop.ip, "Origin");
    if (xoip) addIP(xoip, "Client (X-Originating-IP)");
    if (connecting) addIP(connecting, "Connecting server");
    hops.forEach(function (h) { if (h.ip && !h.providerInternal) addIP(h.ip, "Hop " + h.n); });
    var ips = Object.keys(ipMap).map(function (k) { return ipMap[k]; });
    var keyIP = ipMap[connecting] || (originHop && ipMap[originHop.ip]) || null;
    if (keyIP && keyIP.geo && keyIP.geo.asnType === "hosting" && dmarcRes !== "pass") add("geo", "low", "Sent from a generic hosting network", keyIP.ip + " belongs to " + keyIP.geo.asnLabel + ", common for throwaway mail servers.", 6);
    if (xoip && ipMap[xoip] && ipMap[xoip].geo && ipMap[xoip].geo.threats && ipMap[xoip].geo.threats.length) add("geo", "high", "Sender's client IP is on a threat list", xoip + " (" + ipMap[xoip].geo.threats.join(", ") + ")", 15);

    // Metadata and timeline
    var dateH = H.val("Date"), sentAt = parseDate(dateH);
    var dated = hops.filter(function (h) { return h.date !== null; });
    var firstAt = dated.length ? dated[0].date : null, lastAt = dated.length ? dated[dated.length - 1].date : null;
    var msgId = H.val("Message-ID") || H.val("Message-Id");
    var msgIdDomain = (msgId.match(/@([^>\s]+)>?/) || [])[1] || "";
    if (msgIdDomain && from && orgDomain(msgIdDomain) !== fromOrg && !/outlook\.com|google\.com|gmail\.com|mail\.gmail|amazonses|sendgrid|mailgun|mcsv\.net|mailchimp|exchangelabs|prod\.outlook/i.test(msgIdDomain))
      add("metadata", "low", "Message-ID from another domain", "Generated by " + msgIdDomain + ", not " + fromOrg + ".", 3, H.get("Message-ID") && H.get("Message-ID").i);
    if (!msgId) add("metadata", "low", "Missing Message-ID", "Legitimate mail systems almost always add one.", 4);
    if (sentAt !== null && firstAt !== null) {
      var gap = (firstAt - sentAt) / 1000;
      if (gap < -600) add("metadata", "low", "Date header is in the future", "Sent time is " + fmtDur(-gap) + " after the first server received it.", 5);
      else if (gap > 86400) add("metadata", "low", "Old Date header", "Sent time is " + fmtDur(gap) + " before the first hop. Possibly a replayed message.", 4);
    }

    // Exchange / gateway verdicts
    var ff = tagList(H.val("X-Forefront-Antispam-Report"));
    var msAs = tagList(H.val("X-Microsoft-Antispam"));
    var mbx = tagList(H.val("X-Microsoft-Antispam-Mailbox-Delivery"));
    var num = function (v) { return v === "" || v === undefined || isNaN(+v) ? null : +v; };
    var scl = num(H.val("X-MS-Exchange-Organization-SCL")); if (scl === null) scl = num(ff.scl);
    var pcl = num(H.val("X-MS-Exchange-Organization-PCL")); if (pcl === null) pcl = num(ff.pcl);
    var bcl = num(msAs.bcl); if (bcl === null) bcl = num(ff.bcl);
    var cat = (ff.cat || "").toUpperCase(), sfv = (ff.sfv || "").toUpperCase(), sfty = ff.sfty || "";
    var pp = tagList((H.val("X-Proofpoint-Spam-Details") || "").replace(/\s+/g, ";"));
    var mcScore = num(H.val("X-Mimecast-Spam-Score"));
    var sa = H.val("X-Spam-Status"), saScore = num((sa.match(/score=(-?[\d.]+)/) || [])[1] || H.val("X-Spam-Score"));
    var virusStatus = H.val("X-Virus-Status") || H.val("X-Virus-Scanned") || "";
    var av = { scanned: !!(H.get("X-MS-Exchange-Organization-AVStamp-Service") || H.get("X-MS-Exchange-Organization-AVStamp-Enterprise") || H.get("X-Virus-Scanned") || H.get("X-Proofpoint-Virus-Version") || pp.malwarescore !== undefined), verdict: "unknown" };
    if (cat === "MALW" || cat === "AMP" || /infected|virus found/i.test(virusStatus) || (num(pp.malwarescore) || 0) >= 50) av.verdict = "malware";
    else if (av.scanned) av.verdict = "clean";
    if (av.verdict === "malware") add("malware", "high", "Malware detected", "A gateway flagged malicious content.", 40);
    if (cat === "PHSH" || cat === "HPHSH") add("malware", "high", "Gateway verdict: " + CAT[cat], "Microsoft filtering classified this message as phishing.", 35);
    else if (cat === "SPOOF" || cat === "INTOS") add("malware", "high", "Gateway verdict: " + CAT[cat], "Microsoft filtering flagged sender spoofing.", 25);
    else if (/^(UIMP|DIMP|GIMP)$/.test(cat)) add("malware", "high", "Gateway verdict: " + CAT[cat], "The sender imitates a protected user or domain.", 25);
    else if (cat === "HSPM" || cat === "SPM") add("malware", "med", "Gateway verdict: " + CAT[cat], "", 12);
    else if (cat === "BULK") add("malware", "info", "Gateway verdict: bulk mail", "", 2);
    if (pcl !== null && pcl >= 4) add("malware", "high", "High phishing confidence (PCL " + pcl + ")", "PCL 4 to 8 means the content is likely phishing.", pcl >= 7 ? 22 : 15);
    if (scl !== null && scl >= 5) add("malware", scl >= 7 ? "high" : "med", "Spam confidence " + scl + " of 9", scl >= 7 ? "High confidence spam." : "Treated as spam.", scl >= 7 ? 15 : 10);
    if (scl === -1) add("malware", "info", "Spam filtering bypassed (SCL -1)", "An allow rule skipped filtering, so the gateway verdict carries little weight.", 0);
    if (SFTY[sfty]) add("malware", sfty === "9.25" ? "low" : "high", "Safety tip: " + SFTY[sfty], "", sfty === "9.25" ? 3 : 22);
    var authAs = H.val("X-MS-Exchange-CrossTenant-AuthAs") || H.val("X-MS-Exchange-Organization-AuthAs");
    var authSource = H.val("X-MS-Exchange-CrossTenant-AuthSource") || H.val("X-MS-Exchange-Organization-AuthSource");
    if (/anonymous/i.test(authAs) && from && myDomain && orgDomain(from.domain) === orgDomain(myDomain) && dmarcRes !== "pass")
      add("security", "high", "External sender using your own domain", "Arrived unauthenticated from outside but claims to be from " + from.domain + ".", 25);
    if (mcScore !== null && mcScore >= 5) add("malware", "med", "Mimecast spam score " + mcScore, "", 8);
    if (num(pp.phishscore) !== null && num(pp.phishscore) >= 50) add("malware", "high", "Proofpoint phish score " + pp.phishscore, "", 20);
    if (/^yes/i.test(sa)) add("malware", "med", "SpamAssassin marked as spam", saScore !== null ? "Score " + saScore : "", 10);

    // Custom / extended headers
    var mailer = H.val("X-Mailer") || H.val("User-Agent");
    var mailerNote = "";
    if (mailer) for (var mi = 0; mi < RISKY_MAILERS.length; mi++) {
      var mm = mailer.match(RISKY_MAILERS[mi][0]);
      if (mm) { mailerNote = typeof RISKY_MAILERS[mi][1] === "function" ? RISKY_MAILERS[mi][1](mm) : RISKY_MAILERS[mi][1]; break; }
    }
    if (mailerNote) add("custom", /outdated|phishing kits|spam|old mail client/i.test(mailerNote) ? "med" : "low", "Suspicious mailer: " + mailer.split("(")[0].trim().slice(0, 40), mailerNote, /outdated|phishing kits|spam|old mail client/i.test(mailerNote) ? 8 : 3, (H.get("X-Mailer") || H.get("User-Agent")).i);
    var GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var nmid = H.val("X-MS-Exchange-Organization-Network-Message-Id"), tenant = H.val("X-MS-Exchange-CrossTenant-Id");
    if (nmid && !GUID.test(nmid)) add("custom", "med", "Malformed Network-Message-Id", "Not a valid Exchange identifier, so the header may be forged.", 8);
    if (tenant && !GUID.test(tenant)) add("custom", "med", "Malformed CrossTenant-Id", "Not a valid tenant identifier, so the header may be forged.", 8);

    // ---------- Score and verdict ----------
    var raw = findings.reduce(function (s, f) { return s + f.points; }, 0);
    var score = Math.max(0, Math.min(100, Math.round(raw)));
    var strong = findings.filter(function (f) { return f.sev === "high"; }).length;
    var verdict = score >= 55 ? "phish" : score >= 25 ? "suspicious" : "genuine";
    var evidence = findings.filter(function (f) { return f.sev !== "good" && f.sev !== "info"; }).length + (ar ? 2 : 0) + (scl !== null ? 1 : 0);
    var confidence = evidence >= 6 || strong >= 3 || (verdict === "genuine" && dmarcRes === "pass" && scl !== null && scl <= 1) ? "high" : evidence >= 3 ? "medium" : "low";
    var sevRank = { high: 0, med: 1, low: 2, info: 3, good: 4 };
    findings.sort(function (a, b) { return sevRank[a.sev] - sevRank[b.sev] || b.points - a.points; });

    return {
      headers: list, findings: findings, score: score, verdict: verdict, confidence: confidence,
      routing: { hops: hops, returnPath: returnPath, deliveredTo: deliveredTo, xOrigIP: xoip, connecting: connecting, originHop: originHop, maxDelay: maxDelay },
      identity: { from: from, replyTo: replyTo, sender: sender, returnPath: returnPath, senderIP: firstIP(H.val("X-Sender-IP")), matrix: matrix, myDomain: myDomain },
      auth: { checks: checks, ar: ar, receivedSpf: rspf, dkimSigs: dkimSigs, arcSeals: arcSeals, dkimAligned: dkimAligned, spfAligned: spfAligned },
      metadata: { messageId: msgId, subject: decodeWords(H.val("Subject")), date: dateH, mime: H.val("MIME-Version"), contentType: H.val("Content-Type"), cte: H.val("Content-Transfer-Encoding"), sentAt: sentAt, firstAt: firstAt, lastAt: lastAt, hasAttach: /yes/i.test(H.val("X-MS-Has-Attach")) || /multipart\/mixed/i.test(H.val("Content-Type")) },
      geo: { ips: ips, keyIP: keyIP },
      security: { counts: countTls(hops), authAs: authAs, authSource: authSource, direction: H.val("X-MS-Exchange-Organization-MessageDirectionality"), fromEntity: H.val("X-MS-Exchange-CrossTenant-FromEntityHeader") },
      antispam: { scl: scl, pcl: pcl, bcl: bcl, cat: cat, catLabel: CAT[cat] || cat, sfv: sfv, sfvLabel: SFV[sfv] || "", sfty: sfty, sftyLabel: SFTY[sfty] || "", ctry: ff.ctry || "", lang: ff.lang || "", ptr: ff.ptr || "", helo: ff.h || "", dir: ff.dir || "", av: av, dest: mbx.dest || "", proofpoint: pp, mimecast: mcScore, spamassassin: sa ? { flag: /^yes/i.test(sa) ? "Yes" : "No", score: saScore } : null, hasMs: !!(H.get("X-Forefront-Antispam-Report") || scl !== null) },
      custom: { mailer: mailer, mailerNote: mailerNote, origEmail: xOrigEmail, networkMessageId: nmid, tenantId: tenant, nmidValid: nmid ? GUID.test(nmid) : null, tenantValid: tenant ? GUID.test(tenant) : null }
    };
  }

  function countTls(hops) {
    var c = { tls: 0, plain: 0, internal: 0, unknown: 0 };
    hops.forEach(function (h) { c[h.tls]++; });
    return c;
  }

  function fmtDur(sec) {
    sec = Math.abs(Math.round(sec));
    if (sec < 60) return sec + "s";
    if (sec < 3600) return Math.floor(sec / 60) + "m " + (sec % 60) + "s";
    if (sec < 86400) return Math.floor(sec / 3600) + "h " + Math.floor((sec % 3600) / 60) + "m";
    return Math.floor(sec / 86400) + "d " + Math.floor((sec % 86400) / 3600) + "h";
  }

  var api = { parse: parse, headerBlock: headerBlock, analyze: analyze, ipKind: ipKind, v6groups: v6groups, orgDomain: orgDomain, lookalike: lookalike, decodeWords: decodeWords, fmtDur: fmtDur, MAIL_ASN: MAIL_ASN, HOSTING_ASN: HOSTING_ASN };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HL = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

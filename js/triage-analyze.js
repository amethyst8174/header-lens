// Email triage engine: body, links, QR codes, attachments, IOCs and a combined verdict.
// Reuses the header-lens engine (window.HL) for headers without changing it. No storage, no network.
(function (root) {
  "use strict";

  var TRIAGE_VERSION = "1.0.0";
  var HL = function () { return root.HL; };

  // ---------- Small helpers ----------
  function hostOf(u) { try { return new URL(u).hostname.toLowerCase().replace(/^\[|\]$/g, ""); } catch (e) { return ""; } }
  function orgOf(h) { return HL().orgDomain(h || ""); }
  function isIP(h) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.indexOf(":") > -1; }
  function uniq(a) { var s = {}; return a.filter(function (x) { if (!x || s[x]) return false; s[x] = 1; return true; }); }
  function latin1(bytes) { return root.TriageMime.latin1(bytes); }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function b64urlBytes(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; try { return atob(s); } catch (e) { return ""; } }

  // ---------- URL unwrapping (security gateways and common redirectors) ----------
  function proofpointV3(u) {
    var m = u.match(/urldefense\.com\/v3\/__(.+?)__;([^!]*)!!/);
    if (!m) return null;
    var inner = m[1], repl = b64urlBytes(m[2]), out = "", ri = 0;
    var RUN = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (var i = 0; i < inner.length; i++) {
      if (inner[i] === "*" && inner[i + 1] === "*") { var n = RUN.indexOf(inner[i + 2]) + 2; out += repl.substr(ri, n); ri += n; i += 2; }
      else if (inner[i] === "*") { out += repl.charAt(ri++); }
      else out += inner[i];
    }
    try { return decodeURIComponent(escape(out)); } catch (e) { return out; }
  }
  var UNWRAP = [
    { name: "Microsoft Safe Links", test: /(^|\.)safelinks\.protection\.outlook\.com$/, fn: function (U) { return U.searchParams.get("url"); } },
    { name: "Proofpoint URL Defense v3", test: /^urldefense\.com$/, fn: function (U, raw) { return proofpointV3(raw); } },
    { name: "Proofpoint URL Defense", test: /^urldefense\.proofpoint\.com$/, fn: function (U) { var v = U.searchParams.get("u"); if (!v) return null; if (/\/v2\//.test(U.pathname)) v = v.replace(/-/g, "%").replace(/_/g, "/"); try { return decodeURIComponent(v); } catch (e) { return v; } } },
    { name: "Barracuda Link Protection", test: /^linkprotect\.cudasvc\.com$/, fn: function (U) { return U.searchParams.get("a"); } },
    { name: "Trend Micro Click-time", test: /(^|\.)trendmicro\.com$/, fn: function (U) { return U.searchParams.get("url"); } },
    { name: "Sophos Time-of-Click", test: /(^|\.)protection\.sophos\.com$/, fn: function (U) { var v = U.searchParams.get("u"); try { return v ? atob(v) : null; } catch (e) { return null; } } },
    { name: "Cisco Secure Email", test: /^secure-web\.cisco\.com$/, fn: function (U) { var last = U.pathname.split("/").pop(); try { last = decodeURIComponent(last); } catch (e) {} return /^https?:/.test(last) ? last : null; } },
    { name: "Google redirect", test: /^(www\.)?google\.[a-z.]+$/, fn: function (U) { return U.pathname === "/url" ? (U.searchParams.get("q") || U.searchParams.get("url")) : null; } },
    { name: "Facebook redirect", test: /^l\.facebook\.com$/, fn: function (U) { return U.searchParams.get("u"); } },
    { name: "LinkedIn redirect", test: /(^|\.)linkedin\.com$/, fn: function (U) { return /redir/.test(U.pathname) ? U.searchParams.get("url") : null; } },
    { name: "Slack redirect", test: /^slack-redir\.net$/, fn: function (U) { return U.searchParams.get("url"); } }
  ];
  function unwrap(raw) {
    var url = raw, chain = [];
    for (var depth = 0; depth < 6; depth++) {
      var U; try { U = new URL(url); } catch (e) { break; }
      var h = U.hostname.toLowerCase(), hit = null;
      for (var i = 0; i < UNWRAP.length; i++) if (UNWRAP[i].test.test(h)) { var next = UNWRAP[i].fn(U, url); if (next && /^[a-z][a-z0-9+.-]*:/i.test(next) && next !== url) { hit = UNWRAP[i].name; url = next; } break; }
      if (!hit) break;
      chain.push(hit);
    }
    var mimecast = /(^|\.)protect-[a-z0-9-]+\.mimecast\.com$/.test(hostOf(url)) || /(^|\.)mimecast\.com$/.test(hostOf(url)) && /\/s\//.test(url);
    return { url: url, wrappers: chain, opaque: mimecast ? "Mimecast" : "" };
  }

  // ---------- Reference lists ----------
  var BRANDS = {
    PayPal: ["paypal.com", "paypal.me"], Microsoft: ["microsoft.com", "office.com", "office365.com", "outlook.com", "live.com", "microsoftonline.com", "sharepoint.com", "onmicrosoft.com", "hotmail.com", "msn.com", "microsoft365.com", "azure.com", "windows.net", "bing.com", "skype.com", "aka.ms"],
    Apple: ["apple.com", "icloud.com"], Amazon: ["amazon.com", "amazon.in", "amazon.co.uk", "amazon.de", "amazonaws.com", "aws.com"], Google: ["google.com", "gmail.com", "youtube.com", "googleusercontent.com", "goo.gl", "googleapis.com", "gstatic.com"],
    DocuSign: ["docusign.com", "docusign.net"], Netflix: ["netflix.com"], DHL: ["dhl.com", "dhl.de"], FedEx: ["fedex.com"], LinkedIn: ["linkedin.com", "lnkd.in"], Facebook: ["facebook.com", "fb.com", "facebookmail.com", "meta.com"],
    Adobe: ["adobe.com"], Dropbox: ["dropbox.com"], "Wells Fargo": ["wellsfargo.com"], Chase: ["chase.com"], HSBC: ["hsbc.com", "hsbc.co.uk", "hsbc.co.in"], Coinbase: ["coinbase.com"], Binance: ["binance.com"], WeTransfer: ["wetransfer.com", "we.tl"]
  };
  var BRAND_KEY = { PayPal: "paypal", Microsoft: "microsoft", Apple: "apple", Amazon: "amazon", Google: "google", DocuSign: "docusign", Netflix: "netflix", DHL: "dhl", FedEx: "fedex", LinkedIn: "linkedin", Facebook: "facebook", Adobe: "adobe", Dropbox: "dropbox", "Wells Fargo": "wellsfargo", Chase: "chasebank", HSBC: "hsbc", Coinbase: "coinbase", Binance: "binance", WeTransfer: "wetransfer" };
  function skel(s) { return (s || "").toLowerCase().replace(/rn/g, "m").replace(/vv/g, "w").replace(/0/g, "o").replace(/[1|!]/g, "l").replace(/3/g, "e").replace(/5/g, "s").replace(/[^a-z]/g, ""); }
  function brandOwns(b, h) { var o = orgOf(h); return BRANDS[b].some(function (d) { return o === d || h === d || h.slice(-(d.length + 1)) === "." + d; }); }
  function brandOf(h) { var k = skel(h.split(".").slice(0, -1).join(".")); for (var b in BRAND_KEY) if (k.indexOf(BRAND_KEY[b]) > -1 && !brandOwns(b, h)) return b; return null; }
  var SHORTENERS = /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|tiny\.cc|rb\.gy|s\.id|t\.ly|bl\.ink|qrco\.de|short\.io|v\.gd|urlz\.fr|shorturl\.gg|tr\.ee|linktr\.ee)$/;
  var FREEHOST = /(^|\.)(web\.app|firebaseapp\.com|pages\.dev|workers\.dev|glitch\.me|ngrok\.io|ngrok-free\.app|ngrok\.app|netlify\.app|vercel\.app|blob\.core\.windows\.net|azurewebsites\.net|000webhostapp\.com|weebly\.com|wixsite\.com|square\.site|godaddysites\.com|r2\.dev|ipfs\.io|dweb\.link|surge\.sh|repl\.co|replit\.app|herokuapp\.com|storage\.googleapis\.com|s3\.amazonaws\.com|webflow\.io|framer\.website|notion\.site|typedream\.app|carrd\.co|onrender\.com|trycloudflare\.com|github\.io|gitbook\.io|mystrikingly\.com|yolasite\.com|jimdosite\.com|site123\.me|bubbleapps\.io|firebasestorage\.googleapis\.com)$/;
  var FREEHOST_PATH = [/^docs\.google\.com\/forms/, /^forms\.gle\//, /^forms\.office\.com\//, /^sites\.google\.com\//, /^script\.google\.com\//];
  var BAD_TLD = /\.(zip|mov|top|xyz|click|country|gq|tk|ml|cf|ga|work|rest|support|monster|cyou|sbs|buzz|cfd|lol|quest|icu|bond|beauty|hair|skin|makeup|autos|boats|yachts|mom|rodeo|cam|live)$/;
  var RISKY_EXT = /\.(exe|scr|com|pif|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|msi|msp|msix|appx|lnk|iso|img|vhd|vhdx|cab|jar|reg|cpl|dll|chm|xll|scf|library-ms|url|application|gadget|inf|sys)$/i;
  var MED_EXT = /\.(html?|shtml|mht|mhtml|svg|one|onepkg|xlsm|docm|pptm|xlam|ppam|dotm|xltm|iqy|slk|rtf|zip|rar|7z|gz|tgz|ace|arj|xz)$/i;
  var CUES = [
    ["Urgency", /\b(urgent|immediately|within (24|48|72) hours|suspend(ed)?|deactivat\w+|expir(e|es|ed|ing)|final (notice|warning)|action required|last (warning|chance)|account (will be )?(locked|closed))\b/i],
    ["Credential request", /\b(verify your (account|identity|email)|confirm your (password|account|details)|password (expires|expired|reset)|re-?activate|unusual (sign-?in|activity)|login attempt|validate your)\b/i],
    ["Payment lure", /\b(invoice|payment (failed|due|pending|declined)|wire transfer|bank (details|account)|remittance|overdue|refund|outstanding balance|billing (issue|problem))\b/i],
    ["Gift cards", /\b(gift ?cards?|itunes card|steam card|google play card)\b/i],
    ["Shared document or voicemail", /\b(shared (a|an) (document|file|folder)|voice ?mail|missed (call|fax)|scanned document|e-?sign(ature)?|docu-?sign|review (the )?document)\b/i],
    ["MFA prompt", /\b(authenticator|approve (the )?(sign-?in|request)|security code|one-?time (code|password)|verification code)\b/i]
  ];

  // ---------- Body (HTML and text) ----------
  function bodyAnalysis(parsed, add) {
    var html = parsed.htmlBody || "", text = parsed.textBody || "";
    var links = [], htmlFlags = [], previewText = text, doc = null;
    if (html) {
      // The email's <style> blocks and style attributes are renamed before parsing: the checks still read
      // them as text, and the browser never tries to apply the email's CSS.
      var inert = html.replace(/<style\b/gi, "<hl-style").replace(/<\/style\s*>/gi, "</hl-style>").replace(/(<[^>]*?\s)style\s*=/gi, "$1data-hl-style=");
      doc = new DOMParser().parseFromString(inert, "text/html");
      var hidden = 0, hiddenText = "";
      Array.prototype.forEach.call(doc.querySelectorAll("[data-hl-style]"), function (el) {
        var st = (el.getAttribute("data-hl-style") || "").toLowerCase().replace(/\s+/g, "");
        if (/display:none|visibility:hidden|font-size:0(px|pt|em|%)?(;|$)|max-height:0|opacity:0(;|$)|mso-hide:all/.test(st)) {
          var t = (el.textContent || "").trim(); if (t.length > 20) { hidden++; hiddenText += t.slice(0, 80) + " "; }
        }
      });
      if (hidden) htmlFlags.push({ sev: "med", title: "Hidden text in the body", detail: hidden + " hidden block" + (hidden > 1 ? "s" : "") + ", often used to fool spam filters: \"" + hiddenText.trim().slice(0, 120) + "\"", points: 8 });
      if (doc.querySelector("script")) htmlFlags.push({ sev: "med", title: "Script in the email body", detail: "Legitimate email doesn't need scripts; mail clients block them, but it signals a crafted message.", points: 8 });
      if (doc.querySelector("input[type=password]")) htmlFlags.push({ sev: "high", title: "Password field inside the email", detail: "The message itself asks for a password.", points: 25 });
      if (doc.querySelector("base[href]")) htmlFlags.push({ sev: "med", title: "Base tag rewrites link targets", detail: "<base href=\"" + doc.querySelector("base").getAttribute("href") + "\"> can hide where relative links go.", points: 6 });
      if (doc.querySelector("meta[http-equiv=refresh i]")) htmlFlags.push({ sev: "med", title: "Auto-redirect in the body", detail: "A meta refresh tag redirects automatically.", points: 6 });
      if (doc.querySelector("iframe")) htmlFlags.push({ sev: "med", title: "Embedded frame", detail: "An iframe loads another page inside the message.", points: 6 });
      // Links from markup
      Array.prototype.forEach.call(doc.querySelectorAll("a[href], area[href]"), function (a) { links.push({ raw: a.getAttribute("href"), text: (a.textContent || "").trim().replace(/\s+/g, " "), source: "Link" }); });
      Array.prototype.forEach.call(doc.querySelectorAll("form"), function (f) { links.push({ raw: f.getAttribute("action") || "(no action)", text: "", source: "Form", form: true }); });
      Array.prototype.forEach.call(doc.querySelectorAll("iframe[src]"), function (f) { links.push({ raw: f.getAttribute("src"), text: "", source: "Frame" }); });
      Array.prototype.forEach.call(doc.querySelectorAll("img[src]"), function (im) {
        var src = im.getAttribute("src") || "";
        if (/^https?:/i.test(src)) links.push({ raw: src, text: "", source: "Remote image", image: true, pixel: (im.getAttribute("width") === "1" || im.getAttribute("height") === "1") });
      });
      var meta = doc.querySelector("meta[http-equiv=refresh i]");
      if (meta) { var mu = (meta.getAttribute("content") || "").match(/url=(.+)$/i); if (mu) links.push({ raw: mu[1].trim().replace(/^['"]|['"]$/g, ""), text: "", source: "Auto-redirect" }); }
    }
    // Links written as plain text
    (text.match(/\bhttps?:\/\/[^\s<>"'\])]+/gi) || []).forEach(function (u) { links.push({ raw: u.replace(/[.,;:!?)]+$/, ""), text: "", source: "Text" }); });
    var zw = (text + (doc ? doc.body.textContent : "")).match(/[\u200B-\u200D\u2060\uFEFF]/g);
    if (zw && zw.length > 5) htmlFlags.push({ sev: "low", title: "Invisible characters inside words", detail: zw.length + " zero-width characters, used to break up keywords that filters look for.", points: 4 });
    htmlFlags.forEach(function (f) { add("body", f.sev, f.title, f.detail, f.points); });
    // Wording cues
    var plain = (doc ? doc.body.textContent : "") + "\n" + text + "\n" + (parsed.subject || "");
    var cues = CUES.filter(function (c) { return c[1].test(plain); }).map(function (c) { return c[0]; });
    if (cues.length) add("body", cues.length >= 3 ? "med" : "low", "Phishing language: " + cues.join(", "), "Common pressure tactics found in the subject or body.", Math.min(16, cues.length * 4));
    return { links: links, doc: doc, text: text, cues: cues };
  }

  // Plain-text preview with links replaced by numbered markers. Nothing is rendered as HTML.
  function htmlToPreview(doc, map) {
    var out = "";
    (function walk(node) {
      if (node.nodeType === 3) { out += node.nodeValue.replace(/\s+/g, " "); return; }
      if (node.nodeType !== 1) return;
      var tag = node.tagName.toLowerCase();
      if (/^(script|style|hl-style|head|title|noscript|template)$/.test(tag)) return;
      var st = (node.getAttribute("data-hl-style") || "").toLowerCase().replace(/\s+/g, "");
      if (/display:none|mso-hide:all/.test(st)) return;
      if (/^(p|div|tr|li|h[1-6]|table|blockquote|section)$/.test(tag)) out += "\n";
      if (tag === "br") out += "\n";
      if (tag === "img") { out += "[image" + (node.getAttribute("alt") ? ": " + node.getAttribute("alt") : "") + "]"; return; }
      for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
      if (tag === "a" && node.getAttribute("href") && map.has(node.getAttribute("href"))) out += " [" + map.get(node.getAttribute("href")) + "]";
      if (tag === "td") out += " ";
    })(doc.body);
    return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // ---------- Link checks ----------
  function checkLinks(rawLinks, ctx, myDomain, add) {
    var seen = {}, out = [];
    var PRI = { Link: 0, Form: 1, Text: 2 };
    rawLinks = rawLinks.map(function (l, i) { return [l, i]; }).sort(function (a, b) { return ((PRI[a[0].source] !== undefined ? PRI[a[0].source] : 3) - (PRI[b[0].source] !== undefined ? PRI[b[0].source] : 3)) || a[1] - b[1]; }).map(function (x) { return x[0]; });
    rawLinks.forEach(function (l) {
      var raw = (l.raw || "").trim();
      if (!raw || /^(mailto:|tel:|#|cid:)/i.test(raw)) return;
      var key = l.source + "|" + raw;
      if (seen[key]) return; seen[key] = 1;
      var link = { raw: raw, text: l.text || "", source: l.source, image: !!l.image, pixel: !!l.pixel, form: !!l.form, flags: [], url: raw, wrappers: [], host: "" };
      if (/^javascript:/i.test(raw)) { link.flags.push(["high", "JavaScript link", 25]); out.push(link); return; }
      if (/^data:/i.test(raw)) { link.flags.push([/^data:text\/html/i.test(raw) ? "high" : "med", "Embedded data link (" + raw.slice(5, 25) + "…)", /^data:text\/html/i.test(raw) ? 25 : 8]); link.url = raw.slice(0, 60) + "…"; out.push(link); return; }
      if (/^www\./i.test(raw)) raw = "http://" + raw;
      if (!/^https?:\/\//i.test(raw)) { if (l.form) link.flags.push(["high", "Form in the email posts data", 20]); out.push(link); return; }
      var uw = unwrap(raw);
      link.url = uw.url; link.wrappers = uw.wrappers; link.opaque = uw.opaque;
      var U = null; try { U = new URL(uw.url); } catch (e) {}
      if (!U) { out.push(link); return; }
      var h = U.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      link.host = h;
      if (uw.opaque) link.flags.push(["info", uw.opaque + "-protected link: original destination can't be recovered offline", 0]);
      if (l.form) link.flags.push(["high", "Form submits data to " + h, 25]);
      if (U.username || U.password || /^https?:\/\/[^/]*@/i.test(uw.url)) link.flags.push(["high", "Uses the user@host trick to disguise the real site", 22]);
      if (isIP(h)) {
        link.flags.push(["med", "Points to a raw IP address", 10]);
        var k = HL().ipKind(h); link.kind = k;
        if (k && k.public && ctx.lookup) { link.geo = ctx.lookup(h, k); if (link.geo && link.geo.threats.length) link.flags.push(["high", "IP on a threat list (" + link.geo.threats.join(", ") + ")", 20]); }
      } else {
        var brand = brandOf(h);
        if (brand) link.flags.push(["high", "Imitates " + brand, 22]);
        if (myDomain && HL().lookalike(h, myDomain)) link.flags.push(["high", "Lookalike of your domain " + orgOf(myDomain), 25]);
        if (/(^|\.)xn--/.test(h)) link.flags.push(["med", "Punycode domain, may use look-alike characters", 10]);
        if (SHORTENERS.test(h)) link.flags.push(["low", "URL shortener hides the destination", 5]);
        var hp = h + U.pathname;
        if (FREEHOST.test(h) || FREEHOST_PATH.some(function (re) { return re.test(hp); })) link.flags.push(["med", "Hosted on a free or abuse-prone platform", 10]);
        if (BAD_TLD.test(h)) link.flags.push(["low", "Domain ending often used for abuse (." + h.split(".").pop() + ")", 4]);
        if (h.split(".").length - orgOf(h).split(".").length >= 3) link.flags.push(["low", "Unusually deep subdomain", 3]);
      }
      // What the reader sees vs where it goes
      var shown = (link.text.match(/\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/\s]|$)/i) || [])[1];
      if (shown && !link.image) {
        var sh = hostOf(/^https?:/i.test(shown) ? shown : "http://" + shown);
        if (sh && orgOf(sh) !== orgOf(h) && !isIP(sh)) link.flags.push(["high", "Text shows " + sh + " but goes to " + h, 22]);
      }
      if (/\.(exe|scr|js|vbs|hta|iso|img|zip|rar|7z|msi|lnk|one|html?|svg)(\?|$)/i.test(U.pathname)) link.flags.push(["med", "Downloads a file (" + U.pathname.split("/").pop().slice(0, 40) + ")", 10]);
      if (/(log-?in|sign-?in|verify|account|password|passwd|secure|update|wallet|auth|sso|mfa|2fa|webmail|owa)/i.test(U.pathname + U.search) && !link.image && link.flags.some(function (f) { return f[0] !== "info"; })) link.flags.push(["low", "Login or verification wording in the URL", 4]);
      if (U.protocol === "http:" && (l.form || /(log-?in|sign-?in|password)/i.test(U.pathname))) link.flags.push(["low", "Not encrypted (http)", 3]);
      if (link.pixel) link.flags.push(["info", "Tracking pixel", 0]);
      out.push(link);
    });
    // Merge entries that lead to the same place (e.g. the HTML and plain-text copies of one link).
    var merged = [], byUrl = {};
    out.forEach(function (lk) {
      var key = (lk.image ? "img|" : "") + (lk.form ? "form|" : "") + lk.url;
      var m = byUrl[key];
      if (!m) { lk.raws = [lk.raw]; lk.sources = [lk.source]; byUrl[key] = lk; merged.push(lk); return; }
      if (m.raws.indexOf(lk.raw) < 0) m.raws.push(lk.raw);
      if (m.sources.indexOf(lk.source) < 0) m.sources.push(lk.source);
      if (!m.text && lk.text) m.text = lk.text;
      lk.flags.forEach(function (f) { if (!m.flags.some(function (g) { return g[1] === f[1]; })) m.flags.push(f); });
    });
    out = merged;
    out.forEach(function (lk, i) {
      lk.n = i + 1;
      lk.source = lk.sources.join(", ");
      var pts = lk.flags.reduce(function (s, f) { return s + f[2]; }, 0);
      lk.risk = lk.flags.some(function (f) { return f[0] === "high"; }) ? "high" : lk.flags.some(function (f) { return f[0] === "med"; }) ? "med" : lk.flags.some(function (f) { return f[0] === "low"; }) ? "low" : "ok";
      lk.points = pts;
    });
    var risky = out.filter(function (x) { return x.risk === "high" || x.risk === "med"; });
    // Area points: worst link counts fully, the rest add a little.
    var sorted = out.map(function (x) { return x.points; }).sort(function (a, b) { return b - a; });
    var linkPts = (sorted[0] || 0) + (sorted.slice(1).reduce(function (s, x) { return s + x; }, 0)) * 0.25;
    if (risky.length) add("body", risky.some(function (x) { return x.risk === "high"; }) ? "high" : "med", risky.length + " risky link" + (risky.length > 1 ? "s" : ""), risky.slice(0, 3).map(function (x) { return (x.host || x.url).slice(0, 60) + ": " + x.flags.filter(function (f) { return f[0] !== "info"; }).map(function (f) { return f[1]; }).join(", "); }).join(". "), Math.round(Math.min(60, linkPts)));
    var wrapped = out.filter(function (x) { return x.wrappers.length; }).length;
    if (wrapped) add("body", "info", wrapped + " link" + (wrapped > 1 ? "s" : "") + " unwrapped from security gateways", "Shown with their real destination.", 0);
    return out;
  }

  // ---------- QR codes in images ----------
  function decodeQR(bytes, type) {
    if (typeof root.jsQR !== "function" || typeof createImageBitmap !== "function") return Promise.resolve(null);
    return createImageBitmap(new Blob([bytes], { type: type || "image/png" })).then(function (bmp) {
      var max = 1600, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
      var w = Math.max(1, Math.round(bmp.width * sc)), hgt = Math.max(1, Math.round(bmp.height * sc));
      var cv = document.createElement("canvas"); cv.width = w; cv.height = hgt;
      var cx = cv.getContext("2d", { willReadFrequently: true });
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, hgt); cx.drawImage(bmp, 0, 0, w, hgt);
      var img = cx.getImageData(0, 0, w, hgt);
      var r = root.jsQR(img.data, w, hgt, { inversionAttempts: "attemptBoth" });
      return r && r.data ? r.data : null;
    }).catch(function () { return null; });
  }

  // ---------- Attachments ----------
  function magic(b) {
    var s = latin1(b.subarray(0, 16)), h = hex(b.subarray(0, 8).buffer.slice(b.byteOffset, b.byteOffset + 8));
    if (s.slice(0, 2) === "MZ") return "Windows executable (PE)";
    if (s.slice(0, 4) === "\x7fELF") return "Linux executable (ELF)";
    if (s.slice(0, 5) === "%PDF-") return "PDF document";
    if (s.slice(0, 4) === "PK\x03\x04") return "ZIP archive";
    if (h.slice(0, 16) === "d0cf11e0a1b11ae1") return "OLE compound file (legacy Office / .msg)";
    if (s.slice(0, 4) === "Rar!") return "RAR archive";
    if (s.slice(0, 6) === "7z\xbc\xaf\x27\x1c") return "7-Zip archive";
    if (h.slice(0, 4) === "1f8b") return "GZIP archive";
    if (h.slice(0, 8) === "4c000000") return "Windows shortcut (LNK)";
    if (h.slice(0, 16) === "e4525c7b8cd8a74d") return "OneNote document";
    if (s.slice(0, 5) === "{\\rtf") return "RTF document";
    if (h.slice(0, 16) === "89504e470d0a1a0a") return "PNG image";
    if (h.slice(0, 6) === "ffd8ff") return "JPEG image";
    if (s.slice(0, 4) === "GIF8") return "GIF image";
    if (s.slice(0, 2) === "BM") return "BMP image";
    if (s.slice(0, 4) === "RIFF" && latin1(b.subarray(8, 12)) === "WEBP") return "WEBP image";
    if (b.length > 0x8006 && latin1(b.subarray(0x8001, 0x8006)) === "CD001") return "ISO disk image";
    var head = latin1(b.subarray(0, 512)).toLowerCase();
    if (/<svg[\s>]/.test(head)) return "SVG image";
    if (/<!doctype html|<html|<script|<body|<head|<form|<meta/.test(head)) return "HTML document";
    if (/^(from|received|return-path|mime-version|message-id|date|subject):/m.test(head)) return "Email message";
    return /[\x00-\x08\x0e-\x1f]/.test(latin1(b.subarray(0, 256))) ? "Binary data" : "Text";
  }
  var EXT_TYPE = { exe: "PE", dll: "PE", scr: "PE", cpl: "PE", sys: "PE", pdf: "PDF", zip: "ZIP", docx: "ZIP", xlsx: "ZIP", pptx: "ZIP", docm: "ZIP", xlsm: "ZIP", pptm: "ZIP", jar: "ZIP", apk: "ZIP", odt: "ZIP", doc: "OLE", xls: "OLE", ppt: "OLE", msg: "OLE", rar: "RAR", "7z": "7-Zip", gz: "GZIP", lnk: "LNK", one: "OneNote", rtf: "RTF", png: "PNG", jpg: "JPEG", jpeg: "JPEG", gif: "GIF", bmp: "BMP", webp: "WEBP", iso: "ISO", img: "ISO", html: "HTML", htm: "HTML", svg: "SVG", eml: "Email" };

  function zipEntries(b) {
    // Read the central directory: names, flags, and where each entry's data starts.
    var out = [], dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (var e = b.length - 22; e >= Math.max(0, b.length - 66000); e--) {
      if (dv.getUint32(e, true) !== 0x06054b50) continue;
      var n = dv.getUint16(e + 10, true), off = dv.getUint32(e + 16, true);
      for (var i = 0; i < n && off + 46 <= b.length; i++) {
        if (dv.getUint32(off, true) !== 0x02014b50) break;
        var flags = dv.getUint16(off + 8, true), method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
        var nl = dv.getUint16(off + 28, true), xl = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true), lho = dv.getUint32(off + 42, true);
        out.push({ name: latin1(b.subarray(off + 46, off + 46 + nl)), encrypted: !!(flags & 1), method: method, csize: csize, lho: lho });
        off += 46 + nl + xl + cl;
      }
      break;
    }
    return out;
  }
  function zipRead(b, ent) {
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (ent.lho + 30 > b.length || dv.getUint32(ent.lho, true) !== 0x04034b50) return Promise.resolve(null);
    var start = ent.lho + 30 + dv.getUint16(ent.lho + 26, true) + dv.getUint16(ent.lho + 28, true);
    var data = b.subarray(start, start + ent.csize);
    if (ent.method === 0) return Promise.resolve(data);
    if (ent.method !== 8 || typeof DecompressionStream === "undefined") return Promise.resolve(null);
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer().then(function (x) { return new Uint8Array(x); }).catch(function () { return null; });
  }

  function hashes(bytes) {
    var md5 = root.SparkMD5 ? root.SparkMD5.ArrayBuffer.hash(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) : "";
    var sub = root.crypto && root.crypto.subtle;
    if (!sub) return Promise.resolve({ md5: md5, sha1: "", sha256: "" });
    return Promise.all([sub.digest("SHA-1", bytes), sub.digest("SHA-256", bytes)]).then(function (d) { return { md5: md5, sha1: hex(d[0]), sha256: hex(d[1]) }; });
  }

  function attachmentAnalysis(att, extraLinks) {
    var b = att.bytes, name = att.name || "", ext = (name.match(/\.([a-z0-9]{1,8})$/i) || [])[1] || "";
    ext = ext.toLowerCase();
    var real = b.length ? magic(b) : "Empty";
    var flags = [];
    function f(sev, title, pts) { flags.push([sev, title, pts]); }
    if (/[\u202E\u202D\u200F]/.test(name)) f("high", "Name uses right-to-left characters to fake its extension", 30);
    if (/\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|txt|csv|rtf)\s*\.(exe|scr|js|jse|vbs|hta|html?|lnk|iso|img|bat|cmd|ps1|zip|one|svg)$/i.test(name) || /\s{5,}\.[a-z0-9]+$/i.test(name)) f("high", "Double extension disguises the real file type", 25);
    if (RISKY_EXT.test(name)) f("high", "Dangerous file type (." + ext + ")", 30);
    else if (MED_EXT.test(name)) f("med", "File type often abused in phishing (." + ext + ")", 8);
    var want = EXT_TYPE[ext];
    if (want && b.length && real.indexOf(want === "PE" ? "Windows executable" : want) === -1 && !(want === "ZIP" && /ZIP/.test(real)) && !(want === "HTML" && real === "Text")) f(/executable|LNK|ISO|HTML|OneNote/i.test(real) ? "high" : "med", "Extension says ." + ext + " but content is " + real, /executable|LNK|ISO/i.test(real) ? 30 : 12);
    if (!want && /executable|LNK|ISO/.test(real)) f("high", "Content is " + real, 30);
    var text = /HTML|SVG|Text|RTF|PDF|Email/.test(real) ? latin1(b.subarray(0, Math.min(b.length, 3e6))) : "";
    var tasks = [];
    if (/HTML/.test(real) || /\.(html?|shtml|mht)$/i.test(name)) {
      var smug = /atob\s*\(|new\s+Blob\s*\(|createObjectURL|msSaveOrOpenBlob|\.download\s*=|[A-Za-z0-9+/]{3000,}={0,2}/.test(text);
      if (smug && /Blob|createObjectURL|msSaveOrOpenBlob|\.download/.test(text)) f("high", "HTML smuggling: builds and downloads a file in the browser", 30);
      if (/<input[^>]+type=["']?password|<form[^>]+action/i.test(text)) f("high", "Contains a login form (credential phishing page)", 28);
      if (/window\.location|location\.(href|replace)|http-equiv=["']?refresh/i.test(text)) f("med", "Redirects the browser to another page", 8);
      if (/eval\s*\(|unescape\s*\(|document\.write\s*\(|fromCharCode|\\x[0-9a-f]{2}\\x[0-9a-f]{2}/i.test(text)) f("med", "Obfuscated script", 10);
      (text.match(/https?:\/\/[^\s"'<>)]+/g) || []).slice(0, 50).forEach(function (u) { extraLinks.push({ raw: u, text: "", source: "In " + name.slice(0, 30) }); });
    }
    if (/SVG/.test(real) && /<script|onload=|javascript:/i.test(text)) f("high", "SVG image contains script", 25);
    if (/RTF/.test(real) && /\\objdata|\\objupdate|equation\.3/i.test(text)) f("high", "RTF with embedded objects (exploit technique)", 25);
    if (/PDF/.test(real)) {
      if (/\/JavaScript|\/JS\s*[(<]/.test(text)) f("high", "PDF contains JavaScript", 20);
      if (/\/Launch/.test(text)) f("high", "PDF can launch programs", 25);
      if (/\/OpenAction|\/AA\s*<</.test(text)) f("med", "PDF runs an action when opened", 8);
      if (/\/EmbeddedFile/.test(text)) f("med", "PDF carries embedded files", 10);
      if (/\/AcroForm|\/XFA/.test(text)) f("low", "PDF contains a fillable form", 3);
      if (/\/Encrypt/.test(text)) f("low", "PDF is encrypted, so content checks are limited", 3);
      (text.match(/\/URI\s*\(([^)]+)\)/g) || []).slice(0, 50).forEach(function (m) { extraLinks.push({ raw: m.replace(/^\/URI\s*\(|\)$/g, ""), text: "", source: "In " + name.slice(0, 30) }); });
    }
    if (/OLE/.test(real)) {
      var s16 = latin1(b);
      if (/_\x00V\x00B\x00A\x00_\x00P\x00R\x00O\x00J\x00E\x00C\x00T|M\x00a\x00c\x00r\x00o\x00s/.test(s16)) f("high", "Contains VBA macros", 28);
      if (/\x01Ole10Native|Equation\.3/.test(s16)) f("high", "Contains embedded OLE objects", 18);
    }
    if (/OneNote/.test(real)) f("med", "OneNote file, often used to hide malicious attachments", 12);
    if (/ZIP/.test(real)) {
      var entries = zipEntries(b);
      att.entries = entries.map(function (x) { return x.name; });
      if (entries.some(function (x) { return x.encrypted; })) f("med", "Password-protected archive, contents can't be scanned", 15);
      if (entries.some(function (x) { return /(^|\/)vbaProject\.bin$/i.test(x.name); })) f("high", "Contains VBA macros", 28);
      if (entries.some(function (x) { return /activeX|oleObject|embeddings\/.*\.bin$/i.test(x.name); })) f("med", "Contains embedded objects or ActiveX", 10);
      var inner = entries.filter(function (x) { return RISKY_EXT.test(x.name) || /\.(html?|svg|one|hta)$/i.test(x.name); });
      if (inner.length) f("high", "Archive contains " + inner.slice(0, 3).map(function (x) { return x.name.split("/").pop(); }).join(", "), 25);
      var rels = entries.filter(function (x) { return /\.rels$/i.test(x.name) && !x.encrypted; }).slice(0, 20);
      rels.forEach(function (ent) {
        tasks.push(zipRead(b, ent).then(function (d) {
          if (!d) return;
          var xml = new TextDecoder().decode(d);
          var ext2 = xml.match(/Target="(https?:\/\/[^"]+)"[^>]*TargetMode="External"|TargetMode="External"[^>]*Target="(https?:\/\/[^"]+)"/g) || [];
          ext2.forEach(function (m) {
            var u = (m.match(/Target="([^"]+)"/) || [])[1];
            if (!u) return;
            extraLinks.push({ raw: u, text: "", source: "In " + name.slice(0, 30) });
            if (/attachedTemplate|oleObject|frame/i.test(xml)) f("high", "Loads a remote template or object (" + hostOf(u) + ")", 25);
          });
        }));
      });
    }
    return Promise.all(tasks).then(function () { return hashes(b); }).then(function (hs) {
      var rank = { high: 0, med: 1, low: 2, info: 3 };
      flags.sort(function (a, b) { return rank[a[0]] - rank[b[0]] || b[2] - a[2]; });
      att.real = real; att.ext = ext; att.hashes = hs; att.flags = flags;
      att.points = flags.reduce(function (s, x) { return s + x[2]; }, 0);
      att.risk = flags.some(function (x) { return x[0] === "high"; }) ? "high" : flags.some(function (x) { return x[0] === "med"; }) ? "med" : flags.length ? "low" : "ok";
      return att;
    });
  }

  // ---------- IOCs and hunt queries ----------
  function iocs(r) {
    var H = r.header, out = { ips: [], domains: [], urls: [], hashes: [], emails: [] };
    (H.geo.ips || []).forEach(function (ip) { if (ip.kind && ip.kind.public && !(ip.geo && ip.geo.asnType === "mail")) out.ips.push(ip.ip); });
    var I = H.identity;
    [I.from, I.replyTo, I.returnPath, I.sender].forEach(function (a) { if (a && a.address && a.address.indexOf("@") > -1) { out.emails.push(a.address); out.domains.push(a.domain); } });
    r.links.forEach(function (l) {
      if (!l.host) return;
      if (l.risk === "ok" && l.image) return;
      if (isIP(l.host)) out.ips.push(l.host); else out.domains.push(l.host);
      out.urls.push(l.url);
    });
    r.attachments.forEach(function (a) { if (a.hashes && a.hashes.sha256) out.hashes.push({ name: a.name, sha256: a.hashes.sha256, sha1: a.hashes.sha1, md5: a.hashes.md5 }); });
    // Shared services (free mail, shorteners, big providers) would flood hunt queries, so they stay
    // out of the domain list; the full URLs and sender addresses are still listed.
    var NOISY = /^(gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|live\.com|yahoo\.[a-z.]+|icloud\.com|aol\.com|proton\.me|protonmail\.com|gmx\.[a-z.]+|mail\.com|zoho\.com|yandex\.[a-z]+)$/;
    out.ips = uniq(out.ips);
    out.domains = uniq(out.domains.map(function (d) { return d.toLowerCase(); })).filter(function (d) {
      if (NOISY.test(d) || SHORTENERS.test(d)) return false;
      for (var b in BRANDS) if (brandOwns(b, d)) return false;
      return true;
    }); out.urls = uniq(out.urls); out.emails = uniq(out.emails);
    return out;
  }
  function q(list) { return list.map(function (x) { return "\"" + String(x).replace(/["\\]/g, "") + "\""; }).join(", "); }
  function queries(io) {
    var sha = io.hashes.map(function (h) { return h.sha256; }), kql = [], spl = [];
    if (io.emails.length) kql.push("// Messages from these senders\nEmailEvents\n| where Timestamp > ago(30d)\n| where SenderFromAddress in~ (" + q(io.emails) + ") or SenderMailFromAddress in~ (" + q(io.emails) + ")\n| project Timestamp, RecipientEmailAddress, SenderFromAddress, Subject, DeliveryAction, NetworkMessageId");
    if (io.domains.length || io.urls.length) kql.push("// Clicks and URLs\nUrlClickEvents\n| where Timestamp > ago(30d)\n| where Url has_any (" + q(io.domains) + ")\n| project Timestamp, AccountUpn, Url, ActionType, IsClickedThrough");
    if (io.ips.length || io.domains.length) kql.push("// Endpoint network connections\nDeviceNetworkEvents\n| where Timestamp > ago(30d)\n| where RemoteIP in (" + q(io.ips) + ") or RemoteUrl has_any (" + q(io.domains) + ")\n| project Timestamp, DeviceName, InitiatingProcessAccountName, RemoteIP, RemoteUrl, InitiatingProcessFileName");
    if (sha.length) kql.push("// Attachment hashes on endpoints and in mail\nunion DeviceFileEvents, EmailAttachmentInfo\n| where Timestamp > ago(30d)\n| where SHA256 in (" + q(sha) + ")\n| project Timestamp, DeviceName, RecipientEmailAddress, FileName, SHA256");
    var terms = [];
    if (io.emails.length) terms.push("src_user IN (" + q(io.emails) + ")");
    if (io.ips.length) terms.push("dest_ip IN (" + q(io.ips) + ")");
    if (io.domains.length) terms.push("(" + io.domains.map(function (d) { return "url=\"*" + d.replace(/["\\]/g, "") + "*\""; }).join(" OR ") + ")");
    if (sha.length) terms.push("file_hash IN (" + q(sha) + ")");
    if (terms.length) spl.push("index=* earliest=-30d\n(" + terms.join("\n OR ") + ")\n| stats count min(_time) as first_seen max(_time) as last_seen by sourcetype, src, dest, user\n| convert ctime(first_seen) ctime(last_seen)");
    return { kql: kql.join("\n\n"), spl: spl.join("\n\n") };
  }
  function defang(s) { return String(s).replace(/^http/i, "hxxp").replace(/\./g, "[.]").replace(/@/g, "[@]"); }

  // ---------- Main ----------
  function run(parsed, ctx) {
    ctx = ctx || {};
    var findings = [];
    function add(area, sev, title, detail, points) { findings.push({ area: area, sev: sev, title: title, detail: detail || "", points: points || 0 }); }
    var header = HL().analyze(parsed.headerText || "", { lookup: ctx.lookup, dataVersion: ctx.dataVersion });
    var myDomain = header.identity.myDomain || "";
    var body = bodyAnalysis(parsed, add);
    var extraLinks = [];
    var atts = (parsed.attachments || []).map(function (a) { return { name: a.name, contentType: a.contentType, bytes: a.bytes, embedded: a.embedded, inline: a.inline, cid: a.cid, size: a.bytes.length }; });
    var qrJobs = [];
    // QR codes in image attachments and inline data-URI images
    atts.forEach(function (a) { if (/^image\//.test(a.contentType) || /\.(png|jpe?g|gif|bmp|webp)$/i.test(a.name)) qrJobs.push(decodeQR(a.bytes, a.contentType).then(function (t) { if (t) { a.qr = t; return { text: t, where: a.name }; } return null; })); });
    if (parsed.htmlBody && /src=["']?data:image\//i.test(parsed.htmlBody)) {
      (parsed.htmlBody.match(/data:image\/(png|jpe?g|gif);base64,([A-Za-z0-9+/=\s]+)/gi) || []).slice(0, 10).forEach(function (d, i) {
        var m = d.match(/data:(image\/[a-z]+);base64,(.+)/i);
        try { var bin = atob(m[2].replace(/\s+/g, "")), by = new Uint8Array(bin.length); for (var k = 0; k < bin.length; k++) by[k] = bin.charCodeAt(k);
          qrJobs.push(decodeQR(by, m[1]).then(function (t) { return t ? { text: t, where: "inline image " + (i + 1) } : null; })); } catch (e) {}
      });
    }
    return Promise.all(atts.map(function (a) { return attachmentAnalysis(a, extraLinks); })).then(function () { return Promise.all(qrJobs); }).then(function (qrs) {
      var qrList = qrs.filter(Boolean);
      var allLinks = body.links.concat(extraLinks);
      qrList.forEach(function (q) { allLinks.push({ raw: /^https?:\/\//i.test(q.text) || /^www\./i.test(q.text) ? q.text : "", text: "", source: "QR code (" + q.where + ")" }); });
      var links = checkLinks(allLinks, ctx, myDomain, add);
      var numByRaw = new Map();
      links.forEach(function (l) { l.raws.forEach(function (rw) { if (!numByRaw.has(rw)) numByRaw.set(rw, l.n); }); });
      var preview = body.doc ? htmlToPreview(body.doc, numByRaw) : body.text;
      if (qrList.length) add("body", qrList.some(function (q) { return /^https?:|^www\./i.test(q.text); }) ? "med" : "low", "QR code in the email", qrList.map(function (q) { return q.where + " → " + q.text.slice(0, 80); }).join("; ") + ". QR codes move the click to a phone, outside your web filtering.", 12);
      atts.forEach(function (a) {
        if (a.qr) {
          a.flags.unshift([/^https?:|^www\./i.test(a.qr) ? "med" : "low", "Contains a QR code" + (/^https?:|^www\./i.test(a.qr) ? " linking to " + (hostOf(/^www\./i.test(a.qr) ? "http://" + a.qr : a.qr) || "a website") : ""), 10]);
          a.points += 10;
          if (a.risk === "ok" || a.risk === "low") a.risk = /^https?:|^www\./i.test(a.qr) ? "med" : "low";
        }
      });
      function fmtSize(n) { return n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
      atts.forEach(function (a) {
        if (a.embedded) add("attachments", "info", "Attached email: " + a.name, "Save it and open it in Email triage to analyze it separately.", 0);
        if (a.flags.length) add("attachments", a.risk === "high" ? "high" : a.risk === "med" ? "med" : "low", a.name + ": " + a.flags[0][1] + (a.flags.length > 1 ? " (+" + (a.flags.length - 1) + " more)" : ""), a.flags.map(function (x) { return x[1]; }).join(", ") + " · " + a.real + ", " + fmtSize(a.size), Math.min(60, a.points));
      });
      // Area scores
      function areaScore(area) { return Math.max(0, Math.min(100, Math.round(findings.filter(function (f) { return f.area === area; }).reduce(function (s, f) { return s + f.points; }, 0)))); }
      var areas = { headers: header.score, body: areaScore("body"), attachments: areaScore("attachments") };
      var vals = [areas.headers, areas.body, areas.attachments].sort(function (a, b) { return b - a; });
      var score = Math.max(0, Math.min(100, Math.round(vals[0] + 0.25 * vals[1] + 0.1 * vals[2])));
      var verdict = score >= 55 ? "phish" : score >= 25 ? "suspicious" : "genuine";
      var strong = findings.filter(function (f) { return f.sev === "high"; }).length + header.findings.filter(function (f) { return f.sev === "high"; }).length;
      var c = header.completeness;
      var confidence = strong >= 3 || (verdict === "genuine" && header.confidence === "high" && !findings.some(function (f) { return f.sev === "med" || f.sev === "high"; })) ? "high" : strong >= 1 || header.confidence !== "low" ? "medium" : "low";
      if (c && c.level === "minimal" && strong < 2) confidence = "low";
      if (c && c.level === "minimal" && verdict === "genuine" && !links.length && !atts.length) verdict = "inconclusive";
      var sevRank = { high: 0, med: 1, low: 2, info: 3, good: 4 };
      findings.sort(function (a, b) { return sevRank[a.sev] - sevRank[b.sev] || b.points - a.points; });
      var r = {
        engine: TRIAGE_VERSION, headerEngine: header.engine, dataVersion: ctx.dataVersion || null,
        parsed: { source: parsed.source, subject: parsed.subject || header.metadata.subject, warnings: parsed.warnings || [], textLen: (parsed.textBody || "").length, htmlLen: (parsed.htmlBody || "").length },
        header: header, findings: findings, areas: areas, score: score, verdict: verdict, confidence: confidence, completeness: c,
        links: links, attachments: atts, qr: qrList, preview: preview || body.text, cues: body.cues
      };
      r.iocs = iocs(r); r.queries = queries(r.iocs);
      return r;
    });
  }

  root.Triage = { run: run, unwrap: unwrap, defang: defang, VERSION: TRIAGE_VERSION };
})(typeof globalThis !== "undefined" ? globalThis : this);

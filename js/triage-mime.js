// MIME parser for .eml files and pasted raw message source. Runs in the browser, no network.
// Returns the same shape as TriageMsg.parse: { source, headerText, subject, textBody, htmlBody, attachments }.
(function (root) {
  "use strict";

  function latin1(bytes) {
    var s = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return s;
  }
  function toBytes(bin) { var b = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i) & 255; return b; }
  function decodeText(bytes, charset) {
    charset = (charset || "utf-8").toLowerCase().replace(/^(us-ascii|ascii)$/, "windows-1252");
    try { return new TextDecoder(charset).decode(bytes); } catch (e) { return new TextDecoder("utf-8").decode(bytes); }
  }

  function splitHeadBody(s) {
    var m = s.match(/\r?\n\r?\n/);
    if (!m) return { head: s, body: "" };
    return { head: s.slice(0, m.index), body: s.slice(m.index + m[0].length) };
  }
  function headers(head) {
    var out = [];
    head.replace(/\r\n?/g, "\n").split("\n").forEach(function (line) {
      if (/^[ \t]/.test(line) && out.length) { out[out.length - 1].value += " " + line.trim(); return; }
      var m = line.match(/^([!-9;-~]+):[ \t]?(.*)$/);
      if (m) out.push({ name: m[1].toLowerCase(), value: m[2].trim() });
    });
    return out;
  }
  function hget(hs, name) { for (var i = 0; i < hs.length; i++) if (hs[i].name === name) return hs[i].value; return ""; }

  // "type/sub; a=b; c="d"; filename*=UTF-8''n%C3%A4me" -> { value, params }
  function params(v) {
    var parts = [], cur = "", q = false;
    for (var i = 0; i < v.length; i++) { var c = v[i]; if (c === '"') q = !q; if (c === ";" && !q) { parts.push(cur); cur = ""; } else cur += c; }
    parts.push(cur);
    var out = { value: parts.shift().trim().toLowerCase(), params: {} }, cont = {};
    parts.forEach(function (p) {
      var k = p.indexOf("="); if (k < 0) return;
      var key = p.slice(0, k).trim().toLowerCase(), val = p.slice(k + 1).trim().replace(/^"|"$/g, "");
      var m = key.match(/^([^*]+)\*(\d+)?(\*)?$/);
      if (m) {
        if (m[3] || (!m[2] && key.slice(-1) === "*")) {
          var x = val.match(/^([^']*)'[^']*'(.*)$/);
          try { val = decodeURIComponent(x ? x[2] : val); } catch (e) {}
        }
        (cont[m[1]] = cont[m[1]] || []).push([+(m[2] || 0), val]);
      } else out.params[key] = val;
    });
    Object.keys(cont).forEach(function (k) { out.params[k] = cont[k].sort(function (a, b) { return a[0] - b[0]; }).map(function (x) { return x[1]; }).join(""); });
    return out;
  }

  function decodeCTE(body, cte) {
    cte = (cte || "").toLowerCase();
    if (cte === "base64") {
      var clean = body.replace(/[^A-Za-z0-9+/=]/g, "");
      try { return toBytes(atob(clean.slice(0, clean.length - (clean.length % 4)))); } catch (e) { return toBytes(body); }
    }
    if (cte === "quoted-printable") {
      var s = body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, function (a, h) { return String.fromCharCode(parseInt(h, 16)); });
      return toBytes(s);
    }
    return toBytes(body);
  }

  function walk(raw, res, depth) {
    var hb = splitHeadBody(raw), hs = headers(hb.head);
    var ct = params(hget(hs, "content-type") || "text/plain"), cd = params(hget(hs, "content-disposition") || "");
    var cte = hget(hs, "content-transfer-encoding");
    if (/^multipart\//.test(ct.value) && ct.params.boundary && depth < 20) {
      var b = "--" + ct.params.boundary, body = hb.body, parts = [], idx = body.indexOf(b);
      while (idx > -1) {
        var start = body.indexOf("\n", idx); if (start < 0) break; start++;
        var next = body.indexOf("\n" + b, start);
        if (next < 0) { parts.push(body.slice(start)); break; }
        parts.push(body.slice(start, next).replace(/\r$/, ""));
        if (body.substr(next + 1 + b.length, 2) === "--") break;
        idx = next + 1;
      }
      if (!parts.length) res.warnings.push("A multipart section had no readable parts.");
      parts.forEach(function (p) { walk(p, res, depth + 1); });
      return;
    }
    var name = cd.params.filename || ct.params.name || "";
    if (root.HL && name) name = root.HL.decodeWords(name);
    var bytes = decodeCTE(hb.body, cte);
    var isAttach = cd.value === "attachment" || (!!name && !/^text\/(plain|html)$/.test(ct.value)) || /^message\/rfc822/.test(ct.value);
    if (!isAttach && ct.value === "text/html") { res.htmlBody += (res.htmlBody ? "\n" : "") + decodeText(bytes, ct.params.charset); return; }
    if (!isAttach && (ct.value === "text/plain" || ct.value === "" )) { res.textBody += (res.textBody ? "\n" : "") + decodeText(bytes, ct.params.charset); return; }
    if (!isAttach && /^text\//.test(ct.value)) { res.textBody += (res.textBody ? "\n" : "") + decodeText(bytes, ct.params.charset); return; }
    res.attachments.push({
      name: name || (/^message\/rfc822/.test(ct.value) ? "attached-message.eml" : "unnamed-" + (res.attachments.length + 1) + "." + (ct.value.split("/")[1] || "bin")),
      contentType: ct.value, bytes: bytes, embedded: /^message\/rfc822/.test(ct.value),
      cid: (hget(hs, "content-id") || "").replace(/^<|>$/g, ""), inline: cd.value === "inline",
      encoding: (cte || "").toLowerCase(), declaredName: !!name
    });
  }

  // input: ArrayBuffer (file) or string (pasted source)
  function parseEml(input) {
    // Pasted text is re-encoded as UTF-8 bytes so every part decodes the same way as a file would.
    var raw = latin1(typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input));
    raw = raw.replace(/^﻿/, "").replace(/^\s+/, "");
    var hb = splitHeadBody(raw);
    var res = { source: "eml", headerText: hb.head, subject: "", textBody: "", htmlBody: "", attachments: [], warnings: [] };
    walk(raw, res, 0);
    var subj = hget(headers(hb.head), "subject");
    res.subject = root.HL ? root.HL.decodeWords(subj) : subj;
    return res;
  }

  function looksLikeMsg(bytes) { return bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0; }

  root.TriageMime = { parse: parseEml, looksLikeMsg: looksLikeMsg, latin1: latin1 };
})(typeof globalThis !== "undefined" ? globalThis : this);

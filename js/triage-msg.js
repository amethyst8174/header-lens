// Outlook .msg reader (Compound File Binary + MAPI properties). Runs in the browser, no network.
// Returns { headerText, subject, textBody, htmlBody, attachments: [{ name, contentType, bytes, embedded }] }.
(function (root) {
  "use strict";

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  var END = 0xfffffffe, FREE = 0xffffffff;

  function readCFB(buf) {
    var b = new Uint8Array(buf);
    if (u32(b, 0) !== 0xe011cfd0 || u32(b, 4) !== 0xe11ab1a1) throw new Error("Not an Outlook .msg file");
    var secSize = 1 << u16(b, 0x1e), miniSize = 1 << u16(b, 0x20);
    var nFat = u32(b, 0x2c), dirStart = u32(b, 0x30), cutoff = u32(b, 0x38);
    var miniFatStart = u32(b, 0x3c), nMiniFat = u32(b, 0x40), difatStart = u32(b, 0x44), nDifat = u32(b, 0x48);
    var sectorOff = function (s) { return (s + 1) * secSize; };
    // FAT sector list from the header DIFAT plus any DIFAT chain
    var fatSecs = [];
    for (var i = 0; i < 109 && fatSecs.length < nFat; i++) { var v = u32(b, 0x4c + i * 4); if (v !== FREE) fatSecs.push(v); }
    var d = difatStart, guard = 0;
    while (fatSecs.length < nFat && d !== END && d !== FREE && guard++ < 10000) {
      var off = sectorOff(d), per = secSize / 4 - 1;
      for (i = 0; i < per && fatSecs.length < nFat; i++) fatSecs.push(u32(b, off + i * 4));
      d = u32(b, off + per * 4);
    }
    var fat = new Uint32Array(fatSecs.length * secSize / 4);
    fatSecs.forEach(function (s, k) { var o = sectorOff(s); for (var j = 0; j < secSize / 4; j++) fat[k * secSize / 4 + j] = u32(b, o + j * 4); });
    function chain(start, table) { var out = [], s = start, g = 0; while (s !== END && s !== FREE && s < table.length + 1 && g++ < 1e6) { out.push(s); s = table[s]; } return out; }
    function readBig(start, size) {
      var out = new Uint8Array(size), pos = 0;
      chain(start, fat).forEach(function (s) { if (pos >= size) return; var n = Math.min(secSize, size - pos); out.set(b.subarray(sectorOff(s), sectorOff(s) + n), pos); pos += n; });
      return out;
    }
    // Directory
    var dirBytes = (function () { var parts = chain(dirStart, fat); var out = new Uint8Array(parts.length * secSize); parts.forEach(function (s, k) { out.set(b.subarray(sectorOff(s), sectorOff(s) + secSize), k * secSize); }); return out; })();
    var entries = [];
    for (var e = 0; e + 128 <= dirBytes.length; e += 128) {
      var nameLen = u16(dirBytes, e + 0x40), name = "";
      for (var c = 0; c + 2 < nameLen; c += 2) name += String.fromCharCode(u16(dirBytes, e + c));
      entries.push({ name: name, type: dirBytes[e + 0x42], left: u32(dirBytes, e + 0x44), right: u32(dirBytes, e + 0x48), child: u32(dirBytes, e + 0x4c), start: u32(dirBytes, e + 0x74), size: u32(dirBytes, e + 0x78) });
    }
    var rootE = entries[0];
    var miniStream = rootE && rootE.size ? readBig(rootE.start, rootE.size) : new Uint8Array(0);
    var miniFat = (function () { if (!nMiniFat) return new Uint32Array(0); var raw = readBig(miniFatStart, nMiniFat * secSize); var t = new Uint32Array(raw.length / 4); for (var j = 0; j < t.length; j++) t[j] = u32(raw, j * 4); return t; })();
    function readStream(ent) {
      if (ent.size >= cutoff) return readBig(ent.start, ent.size);
      var out = new Uint8Array(ent.size), pos = 0;
      chain(ent.start, miniFat).forEach(function (s) { if (pos >= ent.size) return; var n = Math.min(miniSize, ent.size - pos); out.set(miniStream.subarray(s * miniSize, s * miniSize + n), pos); pos += n; });
      return out;
    }
    function children(idx) {
      var out = [], stack = [entries[idx].child], g = 0;
      while (stack.length && g++ < 100000) {
        var k = stack.pop();
        if (k === FREE || !entries[k]) continue;
        out.push(k); stack.push(entries[k].left, entries[k].right);
      }
      return out;
    }
    return { entries: entries, readStream: readStream, children: children };
  }

  var dec16 = new TextDecoder("utf-16le");
  function prop(cfb, storageIdx, id) {
    var want = ("__substg1.0_" + id).toUpperCase();
    var kids = cfb.children(storageIdx);
    for (var i = 0; i < kids.length; i++) {
      var en = cfb.entries[kids[i]];
      if (en.name.toUpperCase().indexOf(want) === 0) return { type: en.name.slice(-4).toUpperCase(), data: en.type === 2 ? cfb.readStream(en) : null, idx: kids[i] };
    }
    return null;
  }
  function str(cfb, idx, id, codepage) {
    var p = prop(cfb, idx, id + "001F");
    if (p && p.data) return dec16.decode(p.data).replace(/\0+$/, "");
    p = prop(cfb, idx, id + "001E");
    if (p && p.data) { try { return new TextDecoder(codepage || "windows-1252").decode(p.data).replace(/\0+$/, ""); } catch (e) { return new TextDecoder("windows-1252").decode(p.data).replace(/\0+$/, ""); } }
    return "";
  }
  function bin(cfb, idx, id) { var p = prop(cfb, idx, id + "0102"); return p && p.data ? p.data : null; }

  // Compressed RTF (LZFu, MS-OXRTFCP)
  var LZFU_DICT = "{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx";
  function lzfu(data) {
    var compSize = u32(data, 0), rawSize = u32(data, 4), magic = u32(data, 8);
    if (magic === 0x414c454d) return data.subarray(16, 16 + rawSize); // uncompressed
    var dict = new Uint8Array(4096); for (var i = 0; i < LZFU_DICT.length; i++) dict[i] = LZFU_DICT.charCodeAt(i);
    var w = LZFU_DICT.length, out = [], p = 16, end = Math.min(data.length, compSize + 4);
    while (p < end && out.length < rawSize) {
      var flags = data[p++];
      for (var bit = 0; bit < 8 && p < end && out.length < rawSize; bit++) {
        if (flags & (1 << bit)) {
          var ref = (data[p] << 8) | data[p + 1]; p += 2;
          var off = ref >> 4, len = (ref & 15) + 2;
          if (off === (w & 4095)) return new Uint8Array(out);
          for (var k = 0; k < len; k++) { var ch = dict[(off + k) & 4095]; out.push(ch); dict[w & 4095] = ch; w++; }
        } else { var c = data[p++]; out.push(c); dict[w & 4095] = c; w++; }
      }
    }
    return new Uint8Array(out);
  }
  // Pull the HTML Outlook embeds in RTF (\fromhtml), else a rough plain-text conversion.
  function rtfToContent(rtf) {
    var fromHtml = /\\fromhtml/.test(rtf);
    var out = "", i = 0, stack = [], st = { skip: false, sup: false, tag: false };
    var SKIP = /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|mmathPr)$/;
    while (i < rtf.length) {
      var ch = rtf[i];
      if (ch === "{") {
        stack.push(st); st = { skip: st.skip, sup: st.sup, tag: st.tag };
        var dest = rtf.slice(i + 1, i + 40).match(/^\\\*\\([a-z]+)/i);
        if (dest) { if (/^htmltag/i.test(dest[1])) { st.tag = true; st.sup = false; } else st.skip = true; }
        i++; continue;
      }
      if (ch === "}") { st = stack.pop() || { skip: false, sup: false, tag: false }; i++; continue; }
      if (ch === "\\") {
        var m = rtf.slice(i, i + 40).match(/^\\([a-z]+)(-?\d+)? ?|^\\'([0-9a-f]{2})|^\\([\\{}])|^\\./i);
        if (!m) { i++; continue; }
        if (m[1]) {
          var w = m[1];
          if (SKIP.test(w)) st.skip = true;
          else if (w === "htmlrtf") st.sup = m[2] !== "0";
          else if (!st.skip && !st.sup && (w === "par" || w === "line")) out += fromHtml && st.tag ? "" : "\n";
          else if (!st.skip && !st.sup && w === "tab") out += "\t";
        } else if (!st.skip && !st.sup && m[3]) out += String.fromCharCode(parseInt(m[3], 16));
        else if (!st.skip && !st.sup && m[4]) out += m[4];
        i += m[0].length; continue;
      }
      if (ch !== "\r" && ch !== "\n" && !st.skip && !st.sup) out += ch;
      i++;
    }
    return fromHtml ? { html: out } : { text: out.replace(/\n{3,}/g, "\n\n").trim() };
  }

  function parseMsg(buf) {
    var cfb = readCFB(buf);
    var cp = (function () { return null; })();
    var res = {
      source: "msg",
      headerText: str(cfb, 0, "007D", cp),
      subject: str(cfb, 0, "0037", cp),
      textBody: str(cfb, 0, "1000", cp),
      htmlBody: "",
      attachments: [],
      sender: { name: str(cfb, 0, "0042", cp), email: str(cfb, 0, "0065", cp) || str(cfb, 0, "0C1F", cp) }
    };
    var h = bin(cfb, 0, "1013");
    if (h) { var meta = (new TextDecoder("latin1").decode(h.subarray(0, 2048)).match(/charset=["']?([\w-]+)/i) || [])[1]; try { res.htmlBody = new TextDecoder(meta || "utf-8").decode(h); } catch (e) { res.htmlBody = new TextDecoder("utf-8").decode(h); } }
    else res.htmlBody = str(cfb, 0, "1013", cp);
    if (!res.htmlBody) {
      var r = bin(cfb, 0, "1009");
      if (r) { try { var c = rtfToContent(new TextDecoder("latin1").decode(lzfu(r))); if (c.html) res.htmlBody = c.html; if (!res.textBody && c.text) res.textBody = c.text; } catch (e) {} }
    }
    cfb.children(0).forEach(function (k) {
      var en = cfb.entries[k];
      if (en.type !== 1 || en.name.indexOf("__attach_version1.0_") !== 0) return;
      var name = str(cfb, k, "3707") || str(cfb, k, "3704") || str(cfb, k, "3001") || "attachment";
      var data = bin(cfb, k, "3701");
      var embedded = !data && !!prop(cfb, k, "3701000D");
      res.attachments.push({ name: name, contentType: str(cfb, k, "370E") || "", bytes: data || new Uint8Array(0), embedded: embedded, cid: str(cfb, k, "3712"), inline: false });
    });
    return res;
  }

  root.TriageMsg = { parse: parseMsg };
})(typeof globalThis !== "undefined" ? globalThis : this);

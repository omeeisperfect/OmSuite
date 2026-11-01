// OmSuite Windows — pure best-effort PDF info + text extraction.
// No Electron import, no PDF library vendored. Parses PDF objects, inflates
// FlateDecode streams with zlib, and extracts text from Tj/TJ operators.
// Encrypted PDFs, non-Flate filters and embedded-font encodings are NOT
// decoded; those cases return partial text with a note, never invented text.

const zlib = require('node:zlib');

function countPages(buf) {
  const text = buf.toString('latin1');
  const counts = [...text.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)].map((m) => parseInt(m[1], 10));
  if (counts.length > 0) return Math.max(...counts);
  const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
  return pages;
}

function decodePdfString(raw) {
  // raw: latin1 string between ( and ) with escapes already handled by caller.
  return raw;
}

// Extract literal strings (...) and hex strings <...> from a content stream,
// in order, and join Tj/TJ operands. Returns plain text (best-effort).
function extractTextFromContent(content) {
  let out = '';
  // TJ arrays: [(...) -120 (...) ] TJ  -> concatenate the strings.
  // Tj: (...) Tj.
  // Also handle ' and " operators (show string + newline) best-effort.
  const re = /\((?:\\.|[^\\()])*\)\s*(Tj|TJ|'|")|\[(?:[^\[\]]|\[[^\]]*\])*\]\s*TJ/g;
  // Simpler robust walk: scan for operators and collect preceding strings.
  let i = 0;
  const strings = [];
  function readLiteral(s, start) {
    // start points at '('; returns { value, end } handling nesting + escapes.
    let depth = 0;
    let val = '';
    let j = start;
    while (j < s.length) {
      const ch = s[j];
      if (ch === '\\' && j + 1 < s.length) {
        const nx = s[j + 1];
        if (nx === 'n') val += '\n';
        else if (nx === 'r') val += '\r';
        else if (nx === 't') val += '\t';
        else if (nx === 'b') val += '\b';
        else if (nx === 'f') val += '\f';
        else if (nx === '(' || nx === ')' || nx === '\\') val += nx;
        else if (/[0-7]/.test(nx)) {
          let oct = nx;
          let k = j + 2;
          while (k < s.length && oct.length < 3 && /[0-7]/.test(s[k])) { oct += s[k]; k += 1; }
          val += String.fromCharCode(parseInt(oct, 8));
          j = k - 1;
        } else val += nx;
        j += 2;
        continue;
      }
      if (ch === '(') { depth += 1; if (depth > 1) val += ch; j += 1; continue; }
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) return { value: val, end: j + 1 };
        val += ch; j += 1; continue;
      }
      val += ch; j += 1;
    }
    return { value: val, end: j };
  }
  function readHex(s, start) {
    let j = start + 1;
    let hex = '';
    while (j < s.length && s[j] !== '>') { if (/[0-9A-Fa-f]/.test(s[j])) hex += s[j]; j += 1; }
    let val = '';
    if (hex.length % 2 === 1) hex += '0';
    for (let k = 0; k < hex.length; k += 2) val += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
    return { value: val, end: j + 1 };
  }
  while (i < content.length) {
    const ch = content[i];
    if (ch === '(') {
      const r = readLiteral(content, i);
      strings.push(r.value);
      i = r.end;
      continue;
    }
    if (ch === '<' && content[i + 1] !== '<') {
      const r = readHex(content, i);
      strings.push(r.value);
      i = r.end;
      continue;
    }
    if (ch === '[') {
      // TJ array: collect literals inside until matching ']'.
      let depth = 0;
      let j = i;
      const arrStrings = [];
      while (j < content.length) {
        const c = content[j];
        if (c === '(') { const r = readLiteral(content, j); arrStrings.push(r.value); j = r.end; continue; }
        if (c === '<' && content[j + 1] !== '<') { const r = readHex(content, j); arrStrings.push(r.value); j = r.end; continue; }
        if (c === '[') depth += 1;
        if (c === ']') { depth -= 1; j += 1; if (depth === 0) break; continue; }
        j += 1;
      }
      i = j;
      // Only emit if followed by TJ (skip other arrays).
      const rest = content.slice(i).replace(/^\s+/, '');
      if (rest.startsWith('TJ')) {
        out += arrStrings.join('');
        strings.length = 0;
        i += content.slice(i).indexOf('TJ') + 2;
        continue;
      }
      strings.length = 0;
      continue;
    }
    if (content.startsWith('Tj', i) && !/[A-Za-z]/.test(content[i + 2] || '')) {
      out += strings.join('');
      strings.length = 0;
      i += 2;
      continue;
    }
    if (content.startsWith('TJ', i) && !/[A-Za-z]/.test(content[i + 2] || '')) {
      out += strings.join('');
      strings.length = 0;
      i += 2;
      continue;
    }
    if ((ch === "'" || ch === '"') && strings.length > 0) {
      out += strings.join('') + '\n';
      strings.length = 0;
      i += 1;
      continue;
    }
    if (content.startsWith('T*', i) || content.startsWith('Td', i) || content.startsWith('TD', i) || content.startsWith('Tm', i)) {
      // Line/position moves: treat as a space/newline separator when text exists.
      if (out && !/[\n ]$/.test(out)) out += ' ';
      strings.length = 0;
      i += 2;
      continue;
    }
    if (ch === '%' ) {
      // Comment to end of line.
      const nl = content.indexOf('\n', i);
      i = nl === -1 ? content.length : nl + 1;
      continue;
    }
    i += 1;
  }
  // Trailing literal without operator is not shown text; ignore.
  void re;
  void decodePdfString;
  return out;
}

// Find all "stream ... endstream" bodies, inflate FlateDecode ones, and
// extract text from each. Returns { pageCount, text, streams, inflated, note }.
function parsePdf(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const latin = buf.toString('latin1');
  const pageCount = countPages(buf);
  const encrypted = /\/Encrypt\s/.test(latin);
  let text = '';
  let streams = 0;
  let inflated = 0;
  const notes = [];
  if (encrypted) notes.push('Encrypted PDF: text extraction is not supported.');
  const streamRe = /stream\r?\n/g;
  let m;
  while ((m = streamRe.exec(latin)) !== null) {
    const headerStart = latin.lastIndexOf('<<', m.index);
    const dict = headerStart !== -1 ? latin.slice(headerStart, m.index) : '';
    const endIdx = latin.indexOf('endstream', m.index);
    if (endIdx === -1) break;
    let body = buf.subarray(m.index + m[0].length, endIdx);
    // Trim trailing newline before endstream.
    if (body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10) body = body.subarray(0, body.length - 2);
    else if (body.length >= 1 && (body[body.length - 1] === 10 || body[body.length - 1] === 13)) body = body.subarray(0, body.length - 1);
    streams += 1;
    let content = null;
    if (/\/FlateDecode/.test(dict)) {
      try { content = zlib.inflateSync(body).toString('latin1'); inflated += 1; }
      catch { notes.push('A FlateDecode stream could not be inflated; it was skipped.'); continue; }
    } else if (/\/Filter/.test(dict)) {
      // Unsupported filter (e.g. DCTDecode image, LZW): skip, do not guess.
      continue;
    } else {
      content = body.toString('latin1');
    }
    if (content) {
      const t = extractTextFromContent(content);
      if (t) text += (text && !text.endsWith('\n') ? '\n' : '') + t;
    }
  }
  // De-duplicate notes.
  const note = [...new Set(notes)].join(' ');
  return { pageCount, text, streams, inflated, note, encrypted };
}

module.exports = { countPages, extractTextFromContent, parsePdf };

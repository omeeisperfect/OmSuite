// OmSuite Windows — pure conversion core (no Electron import, no network).
// Only genuinely implemented pairs are offered; anything else must be
// reported as "Not supported" by the caller, never given fake output.
// CSV<->JSON, TXT->Markdown (heuristic, labelled by the UI), JSON pretty-print.

const textCore = require('./text-core');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function csvField(s) {
  const v = String(s ?? '');
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function csvToJson(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return '[]';
  const headers = rows[0].map((h) => (h || '').trim());
  const out = [];
  for (const row of rows.slice(1)) {
    const obj = {};
    headers.forEach((h, i) => { obj[h || ('col' + (i + 1))] = row[i] ?? ''; });
    out.push(obj);
  }
  return JSON.stringify(out, null, 2);
}

function jsonToCsv(text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (err) { throw new Error('Invalid JSON: ' + err.message); }
  if (!Array.isArray(parsed)) throw new Error('JSON to CSV needs an array of objects.');
  if (parsed.length === 0) return '';
  const headers = [];
  for (const obj of parsed) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('JSON to CSV needs an array of flat objects.');
    for (const k of Object.keys(obj)) if (!headers.includes(k)) headers.push(k);
  }
  const lines = [headers.map(csvField).join(',')];
  for (const obj of parsed) {
    lines.push(headers.map((h) => {
      const v = obj[h];
      return csvField(v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
    }).join(','));
  }
  return lines.join('\r\n');
}

// Heuristic TXT -> Markdown. Labelled "heuristic" in the UI: blank-line
// separated blocks become paragraphs; a short single line followed by a
// blank line becomes a heading; lines starting with '- ' / '* ' / '1. '
// are kept as list items.
function txtToMarkdown(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') { out.push(''); continue; }
    if (/^[-*]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) { out.push(trimmed); continue; }
    const nextBlank = lines[i + 1] === undefined || lines[i + 1].trim() === '';
    const prevBlank = i === 0 || lines[i - 1].trim() === '';
    if (prevBlank && nextBlank && trimmed.length <= 60 && !/[.!?]$/.test(trimmed)) {
      out.push('## ' + trimmed);
    } else {
      out.push(trimmed);
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function jsonPretty(text) {
  const r = textCore.validateJson(text);
  if (!r.ok) throw new Error('Invalid JSON: ' + r.error);
  return r.formatted;
}

const SUPPORTED = [
  { from: 'CSV', to: 'JSON', fn: csvToJson },
  { from: 'JSON', to: 'CSV', fn: jsonToCsv },
  { from: 'TXT', to: 'Markdown', fn: txtToMarkdown },
  { from: 'JSON', to: 'JSON (pretty)', fn: jsonPretty },
];

function convert(from, to, text) {
  const pair = SUPPORTED.find((p) => p.from === from && p.to === to);
  if (!pair) return { ok: false, error: 'Not supported: ' + from + ' → ' + to };
  try {
    return { ok: true, value: pair.fn(text) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { parseCsv, csvToJson, jsonToCsv, txtToMarkdown, jsonPretty, convert, SUPPORTED };

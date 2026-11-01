// OmSuite Windows — pure text-editor core (no Electron import; unit-testable).
// The renderer implements the same find/replace rules for live typing; the
// functions here are the tested reference implementation.

function validateJson(text) {
  try {
    const parsed = JSON.parse(text);
    return { ok: true, error: null, formatted: JSON.stringify(parsed, null, 2) };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err), formatted: null };
  }
}

function countWordsChars(text) {
  const t = String(text || '');
  const words = t.trim() === '' ? 0 : t.trim().split(/\s+/).length;
  const lines = t === '' ? 0 : t.split('\n').length;
  return { chars: t.length, words, lines };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// All non-overlapping match start indexes. Empty query -> no matches.
function findAll(text, query, options = {}) {
  const hay = String(text || '');
  const needle = String(query || '');
  if (needle === '') return [];
  const caseSensitive = options.caseSensitive === true;
  const source = caseSensitive ? hay : hay.toLowerCase();
  const target = caseSensitive ? needle : needle.toLowerCase();
  const out = [];
  let i = source.indexOf(target);
  while (i !== -1) {
    out.push(i);
    i = source.indexOf(target, i + Math.max(target.length, 1));
  }
  return out;
}

function replaceAllText(text, query, replacement, options = {}) {
  const matches = findAll(text, query, options);
  if (matches.length === 0) return { text: String(text || ''), count: 0 };
  const pattern = new RegExp(escapeRegExp(String(query)), options.caseSensitive ? 'g' : 'gi');
  return { text: String(text || '').replace(pattern, String(replacement ?? '')), count: matches.length };
}

// Line/column (1-based) for a cursor offset inside text.
function lineCol(text, offset) {
  const t = String(text || '');
  const clamped = Math.max(0, Math.min(offset || 0, t.length));
  const before = t.slice(0, clamped);
  const lines = before.split('\n');
  return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

// Bounded undo/redo history of full snapshots. Simple and predictable:
// push only when the text actually changed; undo/redo never invent text.
class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.past = [];
    this.future = [];
    this.current = '';
  }
  setInitial(text) {
    this.past = [];
    this.future = [];
    this.current = String(text ?? '');
  }
  push(text) {
    const next = String(text ?? '');
    if (next === this.current) return;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = next;
    this.future = [];
  }
  undo() {
    if (this.past.length === 0) return this.current;
    this.future.push(this.current);
    this.current = this.past.pop();
    return this.current;
  }
  redo() {
    if (this.future.length === 0) return this.current;
    this.past.push(this.current);
    this.current = this.future.pop();
    return this.current;
  }
  canUndo() { return this.past.length > 0; }
  canRedo() { return this.future.length > 0; }
}

// Encoding / line-ending metadata for the Code editor. The editor must
// preserve what it found: a BOM stays a BOM, CRLF stays CRLF, so a
// round-trip save does not rewrite a file's line endings behind the user.
function detectTextMeta(text) {
  const t = String(text || '');
  const hasBom = t.charCodeAt(0) === 0xfeff;
  const body = hasBom ? t.slice(1) : t;
  const crlf = (body.match(/\r\n/g) || []).length;
  const lfOnly = (body.replace(/\r\n/g, '').match(/\n/g) || []).length;
  let lineEnding = 'lf';
  if (crlf > 0 && lfOnly === 0) lineEnding = 'crlf';
  else if (crlf > 0 && lfOnly > 0) lineEnding = 'mixed';
  return { hasBom, lineEnding, crlfCount: crlf, lfCount: lfOnly };
}

function applyTextMeta(text, meta) {
  let t = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (meta && meta.lineEnding === 'crlf') t = t.replace(/\n/g, '\r\n');
  if (meta && meta.hasBom) t = '\uFEFF' + t.replace(/^\uFEFF/, '');
  return t;
}

module.exports = { validateJson, countWordsChars, findAll, replaceAllText, lineCol, History, detectTextMeta, applyTextMeta };

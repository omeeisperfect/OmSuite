// OmSuite Windows — pure code tokenizer (no Electron import).
// Returns token spans [{ type, start, end, text }] for JavaScript, Python
// and Kotlin. Types: keyword, string, comment, number, plain (not emitted;
// gaps between spans are plain). Unknown languages return no spans.

const KEYWORDS = {
  javascript: new Set('break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with let of yield async await static get set'.split(' ')),
  python: new Set('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield print'.split(' ')),
  kotlin: new Set('as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while import fun'.split(' ')),
};

function tokenize(code, language) {
  const lang = String(language || '').toLowerCase();
  const keywords = KEYWORDS[lang];
  if (!keywords) return [];
  const src = String(code || '');
  const spans = [];
  let i = 0;
  const push = (type, start, end) => { if (end > start) spans.push({ type, start, end, text: src.slice(start, end) }); };
  while (i < src.length) {
    const ch = src[i];
    const two = src.slice(i, i + 2);
    const three = src.slice(i, i + 3);
    // Comments: Python '#' (not in strings — strings are consumed first when
    // encountered, so a '#' inside a string is already consumed).
    if (lang === 'python' && ch === '#') {
      let j = src.indexOf('\n', i);
      if (j === -1) j = src.length;
      push('comment', i, j); i = j; continue;
    }
    if (two === '//') {
      let j = src.indexOf('\n', i);
      if (j === -1) j = src.length;
      push('comment', i, j); i = j; continue;
    }
    if (two === '/*') {
      let j = src.indexOf('*/', i + 2);
      j = j === -1 ? src.length : j + 2;
      push('comment', i, j); i = j; continue;
    }
    // Strings.
    if (lang === 'python' && (three === "'''" || three === '"""')) {
      const q = three;
      let j = src.indexOf(q, i + 3);
      j = j === -1 ? src.length : j + 3;
      push('string', i, j); i = j; continue;
    }
    if (ch === '"' || ch === "'" || ((lang === 'javascript' || lang === 'kotlin') && ch === '`')) {
      const q = ch;
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) { j += 1; break; }
        if (q !== '`' && src[j] === '\n') break; // unterminated: stop at newline
        j += 1;
      }
      push('string', i, j); i = j; continue;
    }
    // Numbers: 123, 1.5, 0xFF, 1e3.
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(0x[0-9A-Fa-f]+|\d+\.?\d*(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
      push('number', i, i + m[0].length); i += m[0].length; continue;
    }
    // Identifiers / keywords.
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i));
      const word = m[0];
      if (keywords.has(word)) push('keyword', i, i + word.length);
      i += word.length; continue;
    }
    i += 1;
  }
  return spans;
}

// Render spans to escaped HTML (used by the renderer preview via IPC).
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function highlightHtml(code, language) {
  const src = String(code || '');
  const spans = tokenize(src, language);
  let html = '';
  let pos = 0;
  for (const sp of spans) {
    if (sp.start > pos) html += escapeHtml(src.slice(pos, sp.start));
    html += '<span class="tok-' + sp.type + '">' + escapeHtml(sp.text) + '</span>';
    pos = sp.end;
  }
  if (pos < src.length) html += escapeHtml(src.slice(pos));
  return html;
}

module.exports = { tokenize, highlightHtml, KEYWORDS };

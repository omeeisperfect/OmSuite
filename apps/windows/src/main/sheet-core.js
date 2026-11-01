// OmSuite Windows — pure spreadsheet formula core (no Electron import).
// Supports: numbers, text, formulas starting with '=', + - * / parentheses,
// cell refs (A1, case-insensitive), SUM and AVERAGE over ranges (A1:B3).
// Errors are returned as values starting with '#' (like spreadsheets do),
// never thrown for bad user input. Circular refs report '#CIRC!'.

function colToIndex(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function indexToCol(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function parseRef(ref) {
  const m = /^([A-Za-z]+)([0-9]+)$/.exec(String(ref).trim());
  if (!m) return null;
  return { col: colToIndex(m[1]), row: parseInt(m[2], 10) - 1 };
}
function cellName(col, row) { return indexToCol(col) + (row + 1); }

// getCell(grid, row, col): grid is array of rows of raw strings (or undefined).
function getRaw(grid, row, col) {
  if (!grid || row < 0 || col < 0) return '';
  const r = grid[row];
  if (!r) return '';
  const v = r[col];
  return v === undefined || v === null ? '' : String(v);
}

// Tokenize a formula body (without leading '=').
function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if ('+-*/(),:'.includes(ch)) { tokens.push({ t: ch }); i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      const m = /^[0-9]*\.?[0-9]+/.exec(expr.slice(i));
      tokens.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length; continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      const m = /^[A-Za-z]+[0-9]+|^[A-Za-z]+/.exec(expr.slice(i));
      tokens.push({ t: 'word', v: m[0].toUpperCase() });
      i += m[0].length; continue;
    }
    throw new Error('Unexpected character: ' + ch);
  }
  tokens.push({ t: 'eof' });
  return tokens;
}

// Recursive-descent evaluator over tokens. resolveRef(name) -> number|string|error.
function evaluateFormula(body, resolveRef, resolveRange) {
  const tokens = tokenize(body);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  function parseExpr() {
    let v = parseTerm();
    while (peek().t === '+' || peek().t === '-') {
      const op = next().t;
      const rhs = parseTerm();
      v = applyOp(v, rhs, op);
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    while (peek().t === '*' || peek().t === '/') {
      const op = next().t;
      const rhs = parseFactor();
      v = applyOp(v, rhs, op);
    }
    return v;
  }
  function parseFactor() {
    const tk = peek();
    if (tk.t === '-') { next(); const v = parseFactor(); return typeof v === 'number' ? -v : v; }
    if (tk.t === '+') { next(); return parseFactor(); }
    if (tk.t === '(') { next(); const v = parseExpr(); if (peek().t !== ')') throw new Error('Missing )'); next(); return v; }
    if (tk.t === 'num') { next(); return tk.v; }
    if (tk.t === 'word') {
      next();
      if (['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'].includes(tk.v)) {
        if (peek().t !== '(') throw new Error(tk.v + ' needs (range)');
        next();
        const vals = [];
        // Args are comma-separated; each arg is either a range (A1:B3) or a
        // single expression (number / cell ref / nested expression).
        while (true) {
          const argStart = peek();
          if (argStart.t === 'word' && parseRef(argStart.v)) {
            const after = tokens[pos + 1];
            if (after && after.t === ':') {
              next(); // start ref
              next(); // ':'
              const end = next();
              if (end.t !== 'word' || !parseRef(end.v)) throw new Error('Bad range end');
              const rangeVals = resolveRange(argStart.v, end.v);
              if (typeof rangeVals === 'string' && rangeVals.startsWith('#')) return rangeVals;
              vals.push(...rangeVals);
            } else {
              vals.push(parseExpr());
            }
          } else {
            vals.push(parseExpr());
          }
          if (peek().t === ',') { next(); continue; }
          break;
        }
        if (peek().t !== ')') throw new Error('Missing )');
        next();
        const nums = vals.filter((v) => typeof v === 'number');
        const errVal = vals.find((v) => typeof v === 'string' && v.startsWith('#'));
        if (errVal) return errVal;
        if (tk.v === 'SUM') return nums.reduce((a, b) => a + b, 0);
        if (tk.v === 'AVERAGE') return nums.length === 0 ? '#DIV/0!' : nums.reduce((a, b) => a + b, 0) / nums.length;
        if (tk.v === 'COUNT') return nums.length;
        if (tk.v === 'MIN') return nums.length === 0 ? 0 : Math.min(...nums);
        if (tk.v === 'MAX') return nums.length === 0 ? 0 : Math.max(...nums);
      }
      // Plain cell ref.
      return resolveRef(tk.v);
    }
    throw new Error('Unexpected token');
  }
  function applyOp(a, b, op) {
    if (typeof a === 'string' && a.startsWith('#')) return a;
    if (typeof b === 'string' && b.startsWith('#')) return b;
    const x = toNumber(a);
    const y = toNumber(b);
    if (x === null || y === null) return '#VALUE!';
    if (op === '+') return x + y;
    if (op === '-') return x - y;
    if (op === '*') return x * y;
    if (op === '/') return y === 0 ? '#DIV/0!' : x / y;
    return '#VALUE!';
  }
  function toNumber(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      if (v === '') return 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }
  const result = parseExpr();
  if (peek().t !== 'eof') throw new Error('Trailing characters');
  return result;
}

// Evaluate one raw cell value. visiting: Set of cell names on the current chain.
function evaluateCell(grid, row, col, visiting) {
  const raw = getRaw(grid, row, col);
  if (!raw.startsWith('=')) {
    // Plain value: numbers stay numbers for arithmetic, text stays text.
    if (raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
    return raw;
  }
  const name = cellName(col, row);
  if (visiting.has(name)) return '#CIRC!';
  const nextVisiting = new Set(visiting);
  nextVisiting.add(name);
  const resolveRef = (ref) => {
    const p = parseRef(ref);
    if (!p) return '#REF!';
    return evaluateCell(grid, p.row, p.col, nextVisiting);
  };
  const resolveRange = (a, b) => {
    const pa = parseRef(a);
    const pb = parseRef(b);
    if (!pa || !pb) return '#REF!';
    const vals = [];
    for (let r = Math.min(pa.row, pb.row); r <= Math.max(pa.row, pb.row); r += 1) {
      for (let c = Math.min(pa.col, pb.col); c <= Math.max(pa.col, pb.col); c += 1) {
        const v = evaluateCell(grid, r, c, nextVisiting);
        if (typeof v === 'string' && v.startsWith('#')) return v;
        if (typeof v === 'number') vals.push(v);
        else if (String(v).trim() !== '' && Number.isFinite(Number(v))) vals.push(Number(v));
        // Blank / text cells are skipped by SUM/AVERAGE, as in spreadsheets.
      }
    }
    return vals;
  };
  try {
    return evaluateFormula(raw.slice(1), resolveRef, resolveRange);
  } catch (err) {
    return '#ERR!';
  }
}

// Compute the whole grid: returns array of rows of display values
// (numbers, strings, or '#...' error strings).
function computeGrid(grid) {
  const rows = grid ? grid.length : 0;
  let cols = 0;
  for (const r of grid || []) cols = Math.max(cols, r ? r.length : 0);
  const out = [];
  for (let r = 0; r < rows; r += 1) {
    const row = [];
    for (let c = 0; c < cols; c += 1) row.push(evaluateCell(grid, r, c, new Set()));
    out.push(row);
  }
  return out;
}

function formatValue(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
  return String(v ?? '');
}

// Minimal CSV handling for Sheets load/save (quotes, commas, newlines).
function gridToCsv(grid) {
  return (grid || []).map((row) => (row || []).map((cell) => {
    const s = String(cell ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}
function csvToGrid(text) {
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
  return rows;
}

// Sort data rows (optionally keeping row 0 as a header) by one column.
// Numeric-vs-numeric compares numerically, everything else by text.
// Returns a NEW grid; the input is never mutated.
function sortGridRows(grid, col, direction = 'asc', hasHeader = false) {
  const rows = (grid || []).map((r) => [...(r || [])]);
  if (rows.length === 0) return rows;
  const dir = direction === 'desc' ? -1 : 1;
  const head = hasHeader ? rows.shift() : null;
  const cmpVal = (v) => {
    const s = String(v ?? '').trim();
    return s !== '' && Number.isFinite(Number(s)) ? { num: Number(s) } : { str: s };
  };
  rows.sort((a, b) => {
    const x = cmpVal(a[col]);
    const y = cmpVal(b[col]);
    if (x.num !== undefined && y.num !== undefined) return (x.num - y.num) * dir;
    return String(x.str ?? x.num ?? '').localeCompare(String(y.str ?? y.num ?? '')) * dir;
  });
  return head ? [head, ...rows] : rows;
}

// Indexes of rows whose cells contain the query (case-insensitive).
function filterRowIndexes(grid, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return (grid || []).map((_, i) => i);
  const out = [];
  (grid || []).forEach((row, i) => {
    if ((row || []).some((c) => String(c ?? '').toLowerCase().includes(q))) out.push(i);
  });
  return out;
}

function groupThousands(intPart) {
  return String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Display formatting for a computed cell value. Formats: 'general',
// 'number' (2 decimals), 'currency' ($ + grouping + 2 decimals),
// 'percent' (value is a fraction: 0.25 -> 25%), 'date' (ISO date for a
// parseable date string, otherwise unchanged). Non-numbers pass through
// except for the date case.
function formatCellValue(value, format) {
  if (typeof value === 'string' && value.startsWith('#')) return value;
  if (format === 'date') {
    if (typeof value === 'string' && value.trim() !== '') {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return formatValue(value);
  }
  if (typeof value !== 'number') return formatValue(value);
  if (format === 'number') return value.toFixed(2);
  if (format === 'currency') {
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    const intPart = Math.floor(abs);
    const frac = Math.round((abs - intPart) * 100);
    return sign + '$' + groupThousands(intPart) + '.' + String(frac).padStart(2, '0');
  }
  if (format === 'percent') {
    const pct = value * 100;
    const rounded = Math.round(pct * 100) / 100;
    return String(rounded) + '%';
  }
  return formatValue(value);
}

module.exports = { colToIndex, indexToCol, parseRef, cellName, evaluateCell, computeGrid, formatValue, gridToCsv, csvToGrid, sortGridRows, filterRowIndexes, formatCellValue };

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const pdf = require('../src/main/pdf-core');

function minimalPdf() {
  const content = 'BT /F1 12 Tf 72 720 Td (Hello PDF) Tj ET';
  const compressed = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const parts = [];
  const offsets = [];
  const push = (s) => { parts.push(Buffer.from(s, 'latin1')); };
  let len = 0;
  const track = (s) => { offsets.push(len); push(s); len += Buffer.byteLength(s, 'latin1'); };
  push('%PDF-1.4\n'); len = 8;
  track('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  track('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  track('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n');
  const streamHeader = '4 0 obj\n<< /Length ' + compressed.length + ' /Filter /FlateDecode >>\nstream\n';
  offsets.push(len); push(streamHeader); len += Buffer.byteLength(streamHeader, 'latin1');
  parts.push(compressed); len += compressed.length;
  push('\nendstream\nendobj\n'); len += Buffer.byteLength('\nendstream\nendobj\n', 'latin1');
  const xrefPos = len;
  push('xref\n0 5\n0000000000 65535 f \n');
  for (let i = 1; i <= 4; i += 1) push(String(offsets[i - 1]).padStart(10, '0') + ' 00000 n \n');
  push('trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');
  return Buffer.concat(parts);
}

test('extracts text from a FlateDecode stream and counts pages', () => {
  const out = pdf.parsePdf(minimalPdf());
  assert.equal(out.pageCount, 1);
  assert.equal(out.inflated, 1);
  assert.match(out.text, /Hello PDF/);
});
test('Tj and TJ operators concatenate', () => {
  assert.equal(pdf.extractTextFromContent('BT (Hello ) Tj (World) Tj ET'), 'Hello World');
  assert.equal(pdf.extractTextFromContent('BT [(Hel) 10 (lo)] TJ ET'), 'Hello');
});
test('uncompressed stream also extracts', () => {
  const raw = '%PDF-1.4\n1 0 obj\n<< /Length 30 >>\nstream\nBT (Plain) Tj ET\nendstream\nendobj\n';
  const out = pdf.parsePdf(Buffer.from(raw, 'latin1'));
  assert.match(out.text, /Plain/);
});

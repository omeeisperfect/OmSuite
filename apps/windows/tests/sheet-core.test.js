const test = require('node:test');
const assert = require('node:assert/strict');
const sheet = require('../src/main/sheet-core');

test('arithmetic, parens and precedence', () => {
  const g = [['=1+2*3', '=(1+2)*3', '=10/4', '=5-8']];
  const out = sheet.computeGrid(g);
  assert.deepEqual(out[0], [7, 9, 2.5, -3]);
});
test('cell refs and SUM/AVERAGE over ranges', () => {
  const g = [['2', '3'], ['4', '5'], ['=SUM(A1:B2)', '=AVERAGE(A1:A2)', '=A1+B2']];
  const out = sheet.computeGrid(g);
  assert.deepEqual(out[2], [14, 3, 7]);
});
test('errors: div0, bad ref, circular', () => {
  const g = [['=1/0'], ['=ZZZ'], ['=C1'], ['=C3']]; // C1 self? rows: use explicit
  const out = sheet.computeGrid(g);
  assert.equal(out[0][0], '#DIV/0!');
  assert.equal(out[1][0], '#REF!');
  // Circular: A1 -> B1 -> A1
  const circ = [['=B1', '=A1']];
  assert.equal(sheet.computeGrid(circ)[0][0], '#CIRC!');
});
test('text cells pass through, empty cells are 0 in arithmetic', () => {
  const g = [['hello', '', '=A2+1']];
  const out = sheet.computeGrid(g);
  assert.equal(out[0][0], 'hello');
  assert.equal(out[0][2], 1);
});
test('csv round-trip with quotes and commas', () => {
  const g = [['a,b', 'say "hi"', 'plain'], ['1', '2', '3']];
  const csv = sheet.gridToCsv(g);
  assert.deepEqual(sheet.csvToGrid(csv), g);
});

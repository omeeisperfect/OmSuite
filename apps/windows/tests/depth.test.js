const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sheet = require('../src/main/sheet-core');
const zip = require('../src/main/zip-core');
const epub = require('../src/main/epub-core');
const fileCore = require('../src/main/file-core');
const textCore = require('../src/main/text-core');

test('sheet: MIN/MAX/COUNT over ranges and single values', () => {
  const g = [['2', '8', '5'], ['=MIN(A1:C1)', '=MAX(A1:C1)', '=COUNT(A1:C1)'], ['=MIN(A1,10)', '=MAX(B1,1)', '=COUNT(A1,99)']];
  const out = sheet.computeGrid(g);
  assert.deepEqual(out[1], [2, 8, 3]);
  assert.deepEqual(out[2], [2, 8, 2]);
});

test('sheet: sortGridRows keeps header, numeric sort, does not mutate', () => {
  const g = [['Name', 'Age'], ['Zed', '30'], ['Amy', '9'], ['Bob', '25']];
  const sorted = sheet.sortGridRows(g, 1, 'asc', true);
  assert.deepEqual(sorted.map((r) => r[0]), ['Name', 'Amy', 'Bob', 'Zed']);
  assert.deepEqual(g[1], ['Zed', '30']); // input untouched
  const desc = sheet.sortGridRows(g, 0, 'desc', true);
  assert.deepEqual(desc.map((r) => r[0]), ['Name', 'Zed', 'Bob', 'Amy']);
});

test('sheet: filterRowIndexes is case-insensitive and empty query returns all', () => {
  const g = [['Ada', '36'], ['Grace', '32'], ['ada lovelace', 'x']];
  assert.deepEqual(sheet.filterRowIndexes(g, 'ADA'), [0, 2]);
  assert.deepEqual(sheet.filterRowIndexes(g, ''), [0, 1, 2]);
  assert.deepEqual(sheet.filterRowIndexes(g, 'zzz'), []);
});

test('sheet: formatCellValue number/currency/percent/date/error', () => {
  assert.equal(sheet.formatCellValue(1234.5, 'number'), '1234.50');
  assert.equal(sheet.formatCellValue(1234.5, 'currency'), '$1,234.50');
  assert.equal(sheet.formatCellValue(-5, 'currency'), '-$5.00');
  assert.equal(sheet.formatCellValue(0.25, 'percent'), '25%');
  assert.equal(sheet.formatCellValue(0.255, 'percent'), '25.5%');
  assert.equal(sheet.formatCellValue('2026-03-04T10:00:00Z', 'date'), '2026-03-04');
  assert.equal(sheet.formatCellValue('#DIV/0!', 'currency'), '#DIV/0!');
  assert.equal(sheet.formatCellValue('hello', 'number'), 'hello');
});

test('zip: safeJoin refuses traversal, absolute and drive paths', () => {
  const root = path.parse(path.resolve('x')).root;
  const dest = path.join(os.tmpdir(), 'omsuite-safejoin-test');
  assert.equal(zip.safeJoin(dest, '../evil.txt'), null);
  assert.equal(zip.safeJoin(dest, 'a/../../evil.txt'), null);
  assert.equal(zip.safeJoin(dest, '/etc/passwd'), null);
  assert.equal(zip.safeJoin(dest, 'C:/evil.txt'), null);
  assert.equal(zip.safeJoin(dest, 'sub\\..\\..\\evil.txt'), null);
  assert.equal(zip.safeJoin(dest, 'sub/ok.txt'), path.resolve(dest, 'sub/ok.txt'));
  assert.equal(zip.safeJoin(dest, ''), null);
  void root;
});

test('zip: extractSelected returns only named entries, refuses encrypted', () => {
  const buf = zip.createZip([
    { name: 'a.txt', data: 'AAA' },
    { name: 'b.txt', data: 'BBB' },
    { name: 'dir/c.txt', data: 'CCC' },
  ]);
  const picked = zip.extractSelected(buf, ['b.txt', 'dir/c.txt'], os.tmpdir());
  assert.deepEqual(picked.map((p) => p.name), ['b.txt', 'dir/c.txt']);
  assert.equal(picked[0].data.toString(), 'BBB');
  // Encrypted entry: craft by flipping flag bit 0 in the central directory.
  const enc = Buffer.from(buf);
  const eocd = enc.length - 22;
  const centralOff = enc.readUInt32LE(eocd + 16);
  enc.writeUInt16LE(enc.readUInt16LE(centralOff + 8) | 1, centralOff + 8);
  assert.throws(() => zip.extractSelected(enc, ['a.txt'], os.tmpdir()), /Encrypted/);
});

test('epub: NCX table of contents and chapter titles', () => {
  const container = '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>';
  const opf = '<package><metadata><dc:title>TOC Book</dc:title></metadata><manifest>'
    + '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
    + '<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>'
    + '<item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/></manifest>'
    + '<spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine></package>';
  const ncx = '<ncx><navMap><navPoint><navLabel><text>Part One</text></navLabel><content src="ch1.xhtml"/></navPoint>'
    + '<navPoint><navLabel><text>Part Two</text></navLabel><content src="ch2.xhtml#s2"/></navPoint></navMap></ncx>';
  const buf = zip.createZip([
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/toc.ncx', data: ncx },
    { name: 'OEBPS/ch1.xhtml', data: '<html><body><h1>First Heading</h1><p>Body.</p></body></html>' },
    { name: 'OEBPS/ch2.xhtml', data: '<html><body><p>Second body.</p></body></html>' },
  ]);
  const book = epub.parseEpub(buf);
  assert.equal(book.toc.length, 2);
  assert.equal(book.toc[0].title, 'Part One');
  assert.equal(book.toc[0].path, 'OEBPS/ch1.xhtml');
  assert.equal(book.toc[1].path, 'OEBPS/ch2.xhtml');
  assert.equal(book.chapters[0].title, 'First Heading');
  assert.equal(book.encrypted, false);
});

test('epub: encryption.xml is reported, toc falls back to chapters', () => {
  const container = '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>';
  const opf = '<package><metadata><dc:title>B</dc:title></metadata><manifest>'
    + '<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>'
    + '<spine><itemref idref="c1"/></spine></package>';
  const buf = zip.createZip([
    { name: 'META-INF/container.xml', data: container },
    { name: 'META-INF/encryption.xml', data: '<encryption/>' },
    { name: 'content.opf', data: opf },
    { name: 'ch1.xhtml', data: '<html><body><p>Hi.</p></body></html>' },
  ]);
  const book = epub.parseEpub(buf);
  assert.equal(book.encrypted, true);
  assert.equal(book.toc.length, 1);
  assert.equal(book.toc[0].title, 'Hi.');
});

test('file-core: copyEntryAsync reports progress and never overwrites', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omsuite-copy-'));
  const srcDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(srcDir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'a.txt'), 'hello');
  fs.writeFileSync(path.join(srcDir, 'sub', 'b.txt'), 'world!');
  const destDir = path.join(tmp, 'dest');
  fs.mkdirSync(destDir);
  const seen = [];
  const dest1 = await fileCore.copyEntryAsync(srcDir, destDir, (p) => seen.push(p));
  assert.equal(fs.readFileSync(path.join(dest1, 'sub', 'b.txt'), 'utf8'), 'world!');
  assert.ok(seen.length > 0);
  assert.equal(seen[seen.length - 1].doneFiles, seen[seen.length - 1].totalFiles);
  assert.equal(seen[seen.length - 1].totalBytes, 11);
  // Second copy of the same folder: clash gets a numbered name, original kept.
  const dest2 = await fileCore.copyEntryAsync(srcDir, destDir, () => {});
  assert.notEqual(dest2, dest1);
  assert.match(path.basename(dest2), /Copy/);
  assert.equal(fs.readFileSync(path.join(dest1, 'a.txt'), 'utf8'), 'hello');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('text-core: detect/apply line endings and BOM round-trip', () => {
  assert.deepEqual(
    textCore.detectTextMeta('a\r\nb\r\n'),
    { hasBom: false, lineEnding: 'crlf', crlfCount: 2, lfCount: 0 },
  );
  assert.equal(textCore.detectTextMeta('\uFEFFa\nb').hasBom, true);
  assert.equal(textCore.detectTextMeta('a\nb\r\nc').lineEnding, 'mixed');
  const meta = textCore.detectTextMeta('\uFEFFa\r\nb\r\n');
  assert.equal(textCore.applyTextMeta('a\nb\n', meta), '\uFEFFa\r\nb\r\n');
  assert.equal(textCore.applyTextMeta('a\r\nb\r\n', { hasBom: false, lineEnding: 'lf' }), 'a\nb\n');
});

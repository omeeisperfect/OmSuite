const test = require('node:test');
const assert = require('node:assert/strict');
const zip = require('../src/main/zip-core');
const epub = require('../src/main/epub-core');
const convert = require('../src/main/convert-core');
const hl = require('../src/main/highlight-core');

function syntheticEpub() {
  const container = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const opf = '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Test Book</dc:title><dc:creator>Tester</dc:creator></metadata><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>';
  const ch1 = '<html><body><h1>Chapter One</h1><p>First paragraph.</p><p>Second paragraph.</p></body></html>';
  const ch2 = '<html><body><p>Last chapter text.</p></body></html>';
  return zip.createZip([
    { name: 'mimetype', data: 'application/epub', method: 0 },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/ch1.xhtml', data: ch1 },
    { name: 'OEBPS/ch2.xhtml', data: ch2 },
  ]);
}

test('zip create -> list -> extract round-trip (stored + deflate)', () => {
  const buf = zip.createZip([
    { name: 'a.txt', data: 'hello', method: 0 },
    { name: 'dir/b.txt', data: 'world '.repeat(100) },
  ]);
  const names = zip.listZip(buf).map((e) => e.name);
  assert.deepEqual(names, ['a.txt', 'dir/b.txt']);
  const out = zip.extractZip(buf);
  assert.equal(out[0].data.toString(), 'hello');
  assert.equal(out[1].data.toString(), 'world '.repeat(100));
  // CRC tamper is detected (flip a byte inside the stored 'hello' data,
  // which starts at local-header 30 + name 5 = offset 35).
  const bad = Buffer.from(buf);
  bad[35] ^= 0xff;
  assert.throws(() => zip.extractZip(bad), /CRC mismatch/);
});

test('epub: container + opf + spine chapters as plain text', () => {
  const book = epub.parseEpub(syntheticEpub());
  assert.equal(book.title, 'Test Book');
  assert.equal(book.creator, 'Tester');
  assert.equal(book.chapters.length, 2);
  assert.match(book.chapters[0].text, /Chapter One/);
  assert.match(book.chapters[0].text, /First paragraph\.\nSecond paragraph\./);
  assert.match(book.chapters[1].text, /Last chapter text/);
});
test('epub: missing container is an error, not invented content', () => {
  const buf = zip.createZip([{ name: 'x.txt', data: 'hi' }]);
  assert.throws(() => epub.parseEpub(buf), /container\.xml/);
});

test('convert: CSV<->JSON round-trip and unsupported pair', () => {
  const csv = 'name,age\nAda,36\nGrace,32';
  const json = convert.convert('CSV', 'JSON', csv);
  assert.equal(json.ok, true);
  assert.deepEqual(JSON.parse(json.value), [{ name: 'Ada', age: '36' }, { name: 'Grace', age: '32' }]);
  const back = convert.convert('JSON', 'CSV', json.value);
  assert.equal(back.ok, true);
  assert.match(back.value, /name,age/);
  const bad = convert.convert('PDF', 'TXT', 'x');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Not supported/);
});
test('convert: TXT->Markdown heuristic and JSON pretty', () => {
  const md = convert.convert('TXT', 'Markdown', 'My Title\n\nSome body text.\n\n- item one\n');
  assert.match(md.value, /## My Title/);
  assert.match(md.value, /- item one/);
  const pretty = convert.convert('JSON', 'JSON (pretty)', '{"a":1}');
  assert.equal(pretty.value, '{\n  "a": 1\n}');
});

test('highlight: keywords, strings, comments, numbers per language', () => {
  const js = hl.tokenize('const x = 42; // note\nconst s = "hi";', 'javascript');
  const types = js.map((t) => t.type + ':' + t.text);
  assert.ok(types.includes('keyword:const'));
  assert.ok(types.includes('number:42'));
  assert.ok(types.includes('comment:// note'));
  assert.ok(types.includes('string:"hi"'));
  const py = hl.tokenize('def f():\n    # comment\n    return "x"', 'python');
  assert.ok(py.some((t) => t.type === 'keyword' && t.text === 'def'));
  assert.ok(py.some((t) => t.type === 'comment' && t.text === '# comment'));
  const kt = hl.tokenize('fun main() { val n = 7 }', 'kotlin');
  assert.ok(kt.some((t) => t.type === 'keyword' && t.text === 'fun'));
  assert.ok(kt.some((t) => t.type === 'keyword' && t.text === 'val'));
  assert.ok(kt.some((t) => t.type === 'number' && t.text === '7'));
  assert.deepEqual(hl.tokenize('anything', 'cobol'), []);
  // String content is not tokenized as comment/keyword.
  const tricky = hl.tokenize('const s = "// not a comment";', 'javascript');
  assert.ok(!tricky.some((t) => t.type === 'comment'));
});

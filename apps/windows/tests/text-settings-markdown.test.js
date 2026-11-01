// OmSuite Windows — text-core, settings-store, markdown tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const tc = require('../src/main/text-core');
const { SettingsStore } = require('../src/main/settings-store');
const md = require('../src/renderer/markdown');

test('validateJson: valid parses, invalid reports, formatted output is stable', () => {
  const good = tc.validateJson('{"b": 1, "a": [1, 2]}');
  assert.equal(good.ok, true);
  assert.equal(good.formatted, '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}');
  const bad = tc.validateJson('{"a": }');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Unexpected token|Expected/);
});

test('findAll and replaceAllText: case handling and counts', () => {
  assert.deepEqual(tc.findAll('Hello hello HELLO', 'hello'), [0, 6, 12]);
  assert.deepEqual(tc.findAll('Hello hello HELLO', 'hello', { caseSensitive: true }), [6]);
  assert.deepEqual(tc.findAll('abc', ''), []);
  const r = tc.replaceAllText('a-b-a-b', 'a', 'X');
  assert.equal(r.text, 'X-b-X-b');
  assert.equal(r.count, 2);
  assert.equal(tc.replaceAllText('abc', 'z', 'X').count, 0);
});

test('History undo/redo round-trip, no-op pushes ignored', () => {
  const h = new tc.History();
  h.setInitial('one');
  h.push('one'); // no-op
  assert.equal(h.canUndo(), false);
  h.push('one two');
  h.push('one two three');
  assert.equal(h.undo(), 'one two');
  assert.equal(h.undo(), 'one');
  assert.equal(h.redo(), 'one two');
  h.push('changed'); // new edit clears redo
  assert.equal(h.canRedo(), false);
  assert.equal(h.undo(), 'one two');
});

test('lineCol is 1-based', () => {
  assert.deepEqual(tc.lineCol('ab\ncd', 0), { line: 1, col: 1 });
  assert.deepEqual(tc.lineCol('ab\ncd', 3), { line: 2, col: 1 });
  assert.deepEqual(tc.lineCol('ab\ncd', 5), { line: 2, col: 3 });
});

test('countWordsChars', () => {
  assert.deepEqual(tc.countWordsChars(''), { chars: 0, words: 0, lines: 0 });
  assert.deepEqual(tc.countWordsChars('hello world\nsecond'), { chars: 18, words: 3, lines: 2 });
});

test('settings store: defaults, persist, favourites, recents cap and toggle', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omsuite-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new SettingsStore(dir);
  const d = s.load();
  assert.equal(d.theme, 'system');
  assert.equal(d.recentsEnabled, true);
  assert.deepEqual(d.favourites, []);
  s.addFavourite('C:\\Docs');
  s.addFavourite('C:\\Docs'); // dedupe
  assert.deepEqual(s.get().favourites, ['C:\\Docs']);
  s.removeFavourite('C:\\Docs');
  assert.deepEqual(s.get().favourites, []);
  for (let i = 0; i < 25; i += 1) s.addRecent({ path: `/f${i}`, name: `f${i}`, kind: 'file' });
  assert.equal(s.get().recents.length, 20); // default cap
  assert.equal(s.get().recents[0].path, '/f24'); // newest first
  assert.equal(fs.existsSync(path.join(dir, 'omsuite-settings.json.tmp')), false); // atomic: no tmp left
  const s2 = new SettingsStore(dir);
  assert.equal(s2.load().recents.length, 20); // persisted across instances
  s2.set({ recentsEnabled: false });
  s2.addRecent({ path: '/new', name: 'new', kind: 'file' });
  assert.equal(s2.get().recents.length, 20); // disabled: no new recents
  s2.clearRecents();
  assert.deepEqual(s2.get().recents, []);
});

test('settings store: corrupt file falls back to defaults, does not crash', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omsuite-settings-bad-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'omsuite-settings.json'), '{not json');
  const s = new SettingsStore(dir);
  assert.equal(s.load().theme, 'system');
});

test('markdown: headings/bold/lists/code, script injection escaped, javascript: links blocked', () => {
  const html = md.renderMarkdown('# Title\nHello **bold** and *italic*\n- one\n- two\n```\n<script>alert(1)</script>\n```');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  const link = md.renderMarkdown('[click](javascript:alert(1))');
  assert.doesNotMatch(link, /javascript:/);
  const okLink = md.renderMarkdown('[docs](https://example.com/a)');
  assert.match(okLink, /href="https:\/\/example\.com\/a"/);
});

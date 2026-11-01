// OmSuite Windows — file-core tests. Run: node --test tests/ (from apps/windows).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const fc = require('../src/main/file-core');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omsuite-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('validateFileName rejects empty, separators, dot names, reserved names', () => {
  assert.equal(fc.validateFileName('').ok, false);
  assert.equal(fc.validateFileName('a/b').ok, false);
  assert.equal(fc.validateFileName('a:b').ok, false);
  assert.equal(fc.validateFileName('..').ok, false);
  assert.equal(fc.validateFileName('CON').ok, false);
  assert.equal(fc.validateFileName('con.txt').ok, false);
  assert.equal(fc.validateFileName('trailing.').ok, false);
  assert.equal(fc.validateFileName('report 2026.txt').ok, true);
  assert.equal(fc.validateFileName('New folder').ok, true);
});

test('list/sort/filter on a real temp folder', (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'bb');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  fs.mkdirSync(path.join(dir, 'ZFolder'));
  const { entries, skipped } = fc.listDirectory(dir);
  assert.equal(skipped, 0);
  assert.equal(entries.length, 3);
  const sorted = fc.sortEntries(entries, 'name', 'asc');
  assert.equal(sorted[0].name, 'ZFolder'); // folders first on name sort
  assert.equal(fc.sortEntries(entries, 'size', 'desc')[0].name, 'b.txt');
  assert.deepEqual(fc.filterEntries(entries, 'A.TXT').map((e) => e.name), ['a.txt']);
  assert.equal(fc.filterEntries(entries, '').length, 3);
});

test('create/rename/duplicate/copy/move/delete round-trip', (t) => {
  const dir = tmpDir(t);
  const folder = fc.createFolder(dir, 'Docs');
  assert.equal(fs.existsSync(folder), true);
  assert.throws(() => fc.createFolder(dir, 'Docs'), /EEXIST/);
  const file = path.join(folder, 'note.txt');
  fs.writeFileSync(file, 'hello');
  const dup = fc.duplicateEntry(file);
  assert.equal(path.basename(dup), 'note - Copy.txt');
  assert.equal(fs.readFileSync(dup, 'utf8'), 'hello');
  const destDir = fc.createFolder(dir, 'Archive');
  const moved = fc.moveEntry(dup, destDir);
  assert.equal(fs.existsSync(moved), true);
  assert.equal(fs.existsSync(dup), false);
  const renamed = fc.renameEntry(moved, 'renamed.txt');
  assert.equal(path.basename(renamed), 'renamed.txt');
  fs.writeFileSync(path.join(destDir, 'taken.txt'), 'taken');
  assert.throws(() => fc.renameEntry(renamed, 'taken.txt'), /already exists/);
  fc.deleteEntry(folder);
  assert.equal(fs.existsSync(folder), false);
});

test('move into itself is refused; deleting a root is refused', (t) => {
  const dir = tmpDir(t);
  const sub = fc.createFolder(dir, 'Sub');
  assert.throws(() => fc.moveEntry(dir, sub), /into itself/);
  const root = path.parse(dir).root;
  assert.throws(() => fc.deleteEntry(root), /filesystem root/);
});

test('copy never overwrites: second copy gets a numbered name', (t) => {
  const dir = tmpDir(t);
  const src = path.join(dir, 'a.txt');
  fs.writeFileSync(src, 'x');
  const other = fc.createFolder(dir, 'Other');
  const c1 = fc.copyEntry(src, other);
  const c2 = fc.copyEntry(src, other);
  assert.equal(path.basename(c1), 'a.txt');
  assert.equal(path.basename(c2), 'a - Copy.txt');
});

test('dirSize counts files and does not follow symlinked dirs', (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'a.txt'), '12345');
  const sub = fc.createFolder(dir, 'Sub');
  fs.writeFileSync(path.join(sub, 'b.txt'), '12');
  const linkTarget = fc.createFolder(dir, 'Real');
  fs.writeFileSync(path.join(linkTarget, 'big.txt'), 'x'.repeat(1000));
  let linkCreated = false;
  try { fs.symlinkSync(linkTarget, path.join(dir, 'Link')); linkCreated = true; } catch { /* symlink privilege may be off */ }
  const s = fc.dirSize(dir);
  assert.equal(s.files >= 3, true);
  if (linkCreated) assert.equal(s.size, 5 + 2 + 1000); // symlink target NOT double-counted
  assert.equal(s.truncated, false);
});

test('readTextFile refuses binary and oversize files', (t) => {
  const dir = tmpDir(t);
  const bin = path.join(dir, 'bin.dat');
  fs.writeFileSync(bin, Buffer.from([0x68, 0x69, 0x00, 0x21]));
  assert.throws(() => fc.readTextFile(bin), /binary/);
  const ok = path.join(dir, 'ok.txt');
  fs.writeFileSync(ok, 'hello\nworld');
  assert.equal(fc.readTextFile(ok).text, 'hello\nworld');
  assert.throws(() => fc.readTextFile(ok, 4), /too large/);
});

test('breadcrumbs: POSIX root and nested path', () => {
  const crumbs = fc.breadcrumbs('/a/b/c');
  assert.deepEqual(crumbs.map((c) => c.name), ['/', 'a', 'b', 'c']);
  assert.equal(crumbs[crumbs.length - 1].path, '/a/b/c');
});

test('formatSize units', () => {
  assert.equal(fc.formatSize(500), '500 B');
  assert.equal(fc.formatSize(2048), '2.0 KB');
  assert.equal(fc.formatSize(5 * 1024 * 1024), '5.0 MB');
});

// OmSuite Windows — pure Node.js file core.
// No Electron import here, so this module is unit-testable with plain `node`.
// Trust model: this app is the user's own file manager running with the user's
// own privileges on the user's own machine (like Windows Explorer). It never
// executes file contents, never runs macros/scripts found in files, and never
// sends a file anywhere. Destructive operations are guarded (see below) and
// the UI confirms before delete, but there is no sandbox beyond the OS:
// a user who points the app at a folder can operate on that folder.

const fs = require('node:fs');
const path = require('node:path');

const MAX_TEXT_BYTES = 10 * 1024 * 1024; // 10 MiB editor guard
const MAX_DIR_ENTRIES_COUNTED = 200000;

// Windows reserved device names (case-insensitive, with or without extension).
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

// Extensions the Editor opens as text (brief: TXT/MD/JSON/XML/YAML/HTML;
// .htm is the same HTML format, .yml the same YAML format).
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.xml', '.yaml', '.yml', '.html', '.htm']);

function isTextExtension(ext) {
  return TEXT_EXTENSIONS.has(String(ext || '').toLowerCase());
}

function validateFileName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    return { ok: false, error: 'Name must not be empty.' };
  }
  if (name !== name.trim()) {
    return { ok: false, error: 'Name must not start or end with a space.' };
  }
  if (name === '.' || name === '..') {
    return { ok: false, error: 'Name must not be "." or "..".' };
  }
  if (/[/\\:*?"<>|]/.test(name)) {
    return { ok: false, error: 'Name must not contain / \\ : * ? " < > |.' };
  }
  if (/[. ]$/.test(name)) {
    return { ok: false, error: 'Name must not end with a dot or a space (Windows rule).' };
  }
  const stem = name.split('.')[0].toUpperCase();
  if (RESERVED_NAMES.has(stem)) {
    return { ok: false, error: `"${stem}" is a reserved Windows device name.` };
  }
  return { ok: true, error: null };
}

function assertValidName(name) {
  const v = validateFileName(name);
  if (!v.ok) throw new Error(v.error);
}

function assertExistingDir(dirPath) {
  if (typeof dirPath !== 'string' || dirPath === '') throw new Error('A folder path is required.');
  let st;
  try {
    st = fs.statSync(dirPath);
  } catch {
    throw new Error(`Folder does not exist: ${dirPath}`);
  }
  if (!st.isDirectory()) throw new Error(`Not a folder: ${dirPath}`);
}

function entryFromPath(dirPath, name) {
  const full = path.join(dirPath, name);
  const st = fs.lstatSync(full); // lstat: a symlink is reported as a symlink, never followed
  const ext = st.isDirectory() ? '' : path.extname(name).toLowerCase();
  return {
    name,
    path: full,
    isDirectory: st.isDirectory(),
    isFile: st.isFile(),
    isSymlink: st.isSymbolicLink(),
    size: st.isFile() ? st.size : 0,
    mtimeMs: st.mtimeMs,
    extension: ext,
  };
}

// List one folder (non-recursive). Throws if the folder cannot be read.
function listDirectory(dirPath) {
  assertExistingDir(dirPath);
  const names = fs.readdirSync(dirPath);
  const entries = [];
  let skipped = 0;
  for (const name of names) {
    try {
      entries.push(entryFromPath(dirPath, name));
    } catch {
      skipped += 1; // unreadable entry: counted, not invented, not fatal
    }
  }
  return { entries, skipped };
}

function sortEntries(entries, key = 'name', direction = 'asc') {
  const dir = direction === 'desc' ? -1 : 1;
  const copy = [...entries];
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  copy.sort((a, b) => {
    // Folders first only for name sort (Explorer-like); other sorts are pure.
    if (key === 'name' && a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    if (key === 'size') return (a.size - b.size) * dir;
    if (key === 'date') return (a.mtimeMs - b.mtimeMs) * dir;
    if (key === 'type') {
      const t = a.extension.localeCompare(b.extension);
      return t !== 0 ? t * dir : byName(a, b) * dir;
    }
    return byName(a, b) * dir;
  });
  return copy;
}

function filterEntries(entries, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter((e) => e.name.toLowerCase().includes(q));
}

function createFolder(parent, name) {
  assertExistingDir(parent);
  assertValidName(name);
  const target = path.join(parent, name);
  fs.mkdirSync(target); // throws EEXIST if present — never silently overwrites
  return target;
}

function renameEntry(entryPath, newName) {
  assertValidName(newName);
  const parent = path.dirname(entryPath);
  const target = path.join(parent, newName);
  if (path.resolve(target) === path.resolve(entryPath)) return target;
  if (fs.existsSync(target)) throw new Error(`"${newName}" already exists in this folder.`);
  fs.renameSync(entryPath, target);
  return target;
}

// "report.txt" -> "report - Copy.txt"; "Photos" -> "Photos - Copy";
// second clash -> "report - Copy (2).txt". Never overwrites.
function uniqueCopyName(dirPath, originalName) {
  const ext = path.extname(originalName);
  const stem = path.basename(originalName, ext);
  let candidate = `${stem} - Copy${ext}`;
  let n = 2;
  while (fs.existsSync(path.join(dirPath, candidate))) {
    candidate = `${stem} - Copy (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

function isInsideDir(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

function copyEntry(src, destDir) {
  assertExistingDir(destDir);
  if (!fs.existsSync(src)) throw new Error(`Source does not exist: ${src}`);
  const base = path.basename(src);
  // Paste into a different folder keeps the original name when free (Explorer
  // behaviour); only a clash gets a " - Copy" name. Duplicating in the same
  // folder always clashes with the source itself, so it always copies.
  const destName = fs.existsSync(path.join(destDir, base)) ? uniqueCopyName(destDir, base) : base;
  const dest = path.join(destDir, destName);
  // dereference:false — a symlink is copied as a symlink, its target is untouched.
  fs.cpSync(src, dest, { recursive: true, dereference: false, errorOnExist: true });
  return dest;
}

function duplicateEntry(src) {
  return copyEntry(src, path.dirname(src));
}

function moveEntry(src, destDir) {
  assertExistingDir(destDir);
  if (!fs.existsSync(src)) throw new Error(`Source does not exist: ${src}`);
  const srcStat = fs.lstatSync(src);
  if (srcStat.isDirectory() && isInsideDir(path.resolve(destDir), path.resolve(src))) {
    throw new Error('A folder cannot be moved into itself or one of its subfolders.');
  }
  const dest = path.join(destDir, path.basename(src));
  if (path.resolve(dest) === path.resolve(src)) return dest; // already there
  const finalDest = fs.existsSync(dest)
    ? path.join(destDir, uniqueCopyName(destDir, path.basename(src)))
    : dest;
  try {
    fs.renameSync(src, finalDest);
  } catch (err) {
    if (err && err.code !== 'EXDEV') throw err;
    // Cross-volume move (e.g. C: -> D:): copy, then delete the source only
    // after the copy succeeded, so a failed copy never loses data.
    fs.cpSync(src, finalDest, { recursive: true, dereference: false, errorOnExist: true });
    deleteEntry(src);
  }
  return finalDest;
}

function deleteEntry(entryPath) {
  if (typeof entryPath !== 'string' || entryPath === '') throw new Error('A path is required.');
  if (path.resolve(entryPath) === path.parse(path.resolve(entryPath)).root) {
    throw new Error('Refusing to delete a filesystem root (drive root).');
  }
  const st = fs.lstatSync(entryPath); // throws if missing — missing is reported, not hidden
  if (st.isDirectory() && !st.isSymbolicLink()) {
    fs.rmSync(entryPath, { recursive: true, force: false });
  } else {
    fs.unlinkSync(entryPath); // file or symlink itself; a symlink target is never deleted
  }
}

// Recursive size/count. Symlinked directories are NOT followed (loop guard).
// Stops counting past MAX_DIR_ENTRIES_COUNTED and reports truncated:true.
function dirSize(dirPath) {
  let size = 0;
  let files = 0;
  let dirs = 0;
  let truncated = false;
  const stack = [dirPath];
  let counted = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    let names;
    try {
      names = fs.readdirSync(current);
    } catch {
      continue;
    }
    for (const name of names) {
      if (counted >= MAX_DIR_ENTRIES_COUNTED) { truncated = true; break; }
      counted += 1;
      const full = path.join(current, name);
      let st;
      try {
        st = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory() && !st.isSymbolicLink()) {
        dirs += 1;
        stack.push(full);
      } else if (st.isFile()) {
        files += 1;
        size += st.size;
      } else {
        files += 1; // symlink / special: counted, size not followed
      }
    }
    if (truncated) break;
  }
  return { size, files, dirs, truncated };
}

function statEntry(entryPath) {
  const st = fs.lstatSync(entryPath);
  return {
    path: entryPath,
    name: path.basename(entryPath),
    isDirectory: st.isDirectory(),
    isFile: st.isFile(),
    isSymlink: st.isSymbolicLink(),
    size: st.isFile() ? st.size : 0,
    mtimeMs: st.mtimeMs,
    birthtimeMs: st.birthtimeMs,
  };
}

// Read a file as UTF-8 text. Refuses binary content and oversize files
// instead of showing garbage or exhausting memory.
function readTextFile(filePath, maxBytes = MAX_TEXT_BYTES) {
  const st = fs.statSync(filePath);
  if (!st.isFile()) throw new Error('Not a file: ' + filePath);
  if (st.size > maxBytes) {
    throw new Error(`File is too large for the Editor (${formatSize(st.size)}; limit ${formatSize(maxBytes)}).`);
  }
  const buf = fs.readFileSync(filePath);
  const head = buf.subarray(0, Math.min(buf.length, 8192));
  if (head.includes(0)) throw new Error('File looks like binary data, not text. It was not opened in the Editor.');
  return { text: buf.toString('utf8'), size: st.size };
}

function writeTextFile(filePath, text) {
  if (typeof text !== 'string') throw new Error('Text is required.');
  fs.writeFileSync(filePath, text, 'utf8');
  return filePath;
}

function formatSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function formatDate(mtimeMs) {
  const d = new Date(mtimeMs);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

// Breadcrumb segments for a path. Root segment is named after the root
// itself ("C:\\" on Windows, "/" on POSIX) so it is never an empty label.
function breadcrumbs(dirPath) {
  const resolved = path.resolve(dirPath);
  const parsed = path.parse(resolved);
  const segments = [{ name: parsed.root, path: parsed.root }];
  const rest = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let acc = parsed.root;
  for (const part of rest) {
    acc = path.join(acc, part);
    segments.push({ name: part, path: acc });
  }
  return segments;
}

module.exports = {
  MAX_TEXT_BYTES,
  TEXT_EXTENSIONS,
  isTextExtension,
  validateFileName,
  listDirectory,
  sortEntries,
  filterEntries,
  createFolder,
  renameEntry,
  uniqueCopyName,
  isInsideDir,
  copyEntry,
  duplicateEntry,
  moveEntry,
  deleteEntry,
  dirSize,
  statEntry,
  readTextFile,
  writeTextFile,
  formatSize,
  formatDate,
  breadcrumbs,
};

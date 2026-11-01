// OmSuite Windows — local settings store (no Electron import; unit-testable).
// One JSON file, written atomically (temp file + rename) so a crash mid-save
// never leaves a half-written settings file. Everything stays on this PC:
// no account, no sync, no network. Recents and favourites are file paths
// only — never file contents.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  theme: 'system', // 'system' | 'light' | 'dark'
  defaultSaveLocation: '',
  recentsEnabled: true,
  recentsMax: 20,
  sidebarWidth: 260,
};

class SettingsStore {
  constructor(dir, fileName = 'omsuite-settings.json') {
    this.dir = dir;
    this.filePath = path.join(dir, fileName);
    this.data = null;
  }

  load() {
    let raw = null;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch {
      raw = null; // first run: no file yet is normal, not an error
    }
    let parsed = {};
    if (raw !== null) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {}; // corrupt file: fall back to defaults, do not crash
      }
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
    this.data = {
      ...DEFAULTS,
      ...parsed,
      favourites: Array.isArray(parsed.favourites) ? parsed.favourites.filter((p) => typeof p === 'string') : [],
      recents: Array.isArray(parsed.recents) ? parsed.recents.filter((r) => r && typeof r.path === 'string') : [],
    };
    if (!['system', 'light', 'dark'].includes(this.data.theme)) this.data.theme = 'system';
    if (typeof this.data.recentsEnabled !== 'boolean') this.data.recentsEnabled = true;
    const max = Number(this.data.recentsMax);
    this.data.recentsMax = Number.isFinite(max) ? Math.max(0, Math.min(50, Math.floor(max))) : 20;
    const w = Number(this.data.sidebarWidth);
    this.data.sidebarWidth = Number.isFinite(w) ? Math.max(180, Math.min(480, Math.floor(w))) : 260;
    return this.data;
  }

  get() {
    if (!this.data) this.load();
    return this.data;
  }

  save() {
    if (!this.data) this.load();
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
    return this.filePath;
  }

  set(patch) {
    const d = this.get();
    Object.assign(d, patch);
    if (patch.theme !== undefined && !['system', 'light', 'dark'].includes(d.theme)) d.theme = 'system';
    if (patch.recentsMax !== undefined) {
      const max = Number(d.recentsMax);
      d.recentsMax = Number.isFinite(max) ? Math.max(0, Math.min(50, Math.floor(max))) : 20;
      d.recents = d.recents.slice(0, d.recentsMax);
    }
    this.save();
    return d;
  }

  addFavourite(folderPath) {
    const d = this.get();
    if (!d.favourites.includes(folderPath)) {
      d.favourites.push(folderPath);
      this.save();
    }
    return d.favourites;
  }

  removeFavourite(folderPath) {
    const d = this.get();
    d.favourites = d.favourites.filter((p) => p !== folderPath);
    this.save();
    return d.favourites;
  }

  addRecent(entry) {
    const d = this.get();
    if (!d.recentsEnabled) return d.recents;
    d.recents = d.recents.filter((r) => r.path !== entry.path);
    d.recents.unshift({ path: entry.path, name: entry.name || path.basename(entry.path), kind: entry.kind || 'file', at: Date.now() });
    d.recents = d.recents.slice(0, d.recentsMax);
    this.save();
    return d.recents;
  }

  clearRecents() {
    const d = this.get();
    d.recents = [];
    this.save();
    return d.recents;
  }
}

module.exports = { SettingsStore, DEFAULTS };

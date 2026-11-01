// OmSuite Windows — Electron main process (thin wiring over pure cores).
// This file is the ONLY place that imports 'electron'. All file/text/settings
// rules live in src/main/*.js and are unit-tested without Electron.
// Security posture: local files only, no remote content, no network requests,
// no execution of file contents. shell.openPath is used only for the user's
// explicit double-click / Open action (the OS default handler, as in Explorer).

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fileCore = require('./main/file-core');
const textCore = require('./main/text-core');
const sheetCore = require('./main/sheet-core');
const pdfCore = require('./main/pdf-core');
const epubCore = require('./main/epub-core');
const zipCore = require('./main/zip-core');
const convertCore = require('./main/convert-core');
const highlightCore = require('./main/highlight-core');

const MAX_BINARY_BYTES = 200 * 1024 * 1024; // 200 MiB guard for media/PDF/EPUB reads
const { SettingsStore } = require('./main/settings-store');

const VERSION = '0.1.0';
const APP_ID = 'com.nimu.omsuite';
const SMOKE = process.argv.includes('--smoke');

let mainWindow = null;
let store = null;

function userDataDir() {
  return app.getPath('userData'); // %APPDATA%/OmSuite on Windows
}

function cacheDir() {
  return path.join(userDataDir(), 'cache');
}

function getStore() {
  if (!store) {
    store = new SettingsStore(userDataDir());
    store.load();
  }
  return store;
}

function ok(value) { return { ok: true, value }; }
function fail(err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }

function wrap(fn) {
  return async (_event, ...args) => {
    try { return ok(await fn(...args)); }
    catch (err) { return fail(err); }
  };
}

function registerIpc() {
  ipcMain.handle('app:get-info', async () => ok({
    version: VERSION, appId: APP_ID, signed: false,
    userDataDir: userDataDir(), platform: process.platform,
    systemDark: nativeTheme.shouldUseDarkColors,
  }));
  ipcMain.handle('app:quit', async () => { app.quit(); return ok(true); });

  ipcMain.handle('files:home-dir', async () => ok(os.homedir()));
  ipcMain.handle('files:list', wrap((dir) => fileCore.listDirectory(dir)));
  ipcMain.handle('files:create-folder', wrap((parent, name) => fileCore.createFolder(parent, name)));
  ipcMain.handle('files:rename', wrap((p, name) => fileCore.renameEntry(p, name)));
  ipcMain.handle('files:copy', wrap((src, dest) => fileCore.copyEntry(src, dest)));
  ipcMain.handle('files:move', wrap((src, dest) => fileCore.moveEntry(src, dest)));
  ipcMain.handle('files:duplicate', wrap((src) => fileCore.duplicateEntry(src)));
  ipcMain.handle('files:delete', wrap((p) => { fileCore.deleteEntry(p); return p; }));
  ipcMain.handle('files:properties', wrap((p) => {
    const st = fileCore.statEntry(p);
    let extra = null;
    if (st.isDirectory) extra = fileCore.dirSize(p);
    return { ...st, ...(extra ? { dirSize: extra } : {}) };
  }));
  ipcMain.handle('files:open-path', wrap(async (p) => {
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
    return p;
  }));

  ipcMain.handle('dialogs:pick-folder', wrap(async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0] || null;
  }));
  ipcMain.handle('dialogs:pick-files', wrap(async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  }));
  ipcMain.handle('dialogs:pick-text-file', wrap(async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Text documents', extensions: ['txt', 'md', 'json', 'xml', 'yaml', 'yml', 'html', 'htm'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return r.canceled ? null : r.filePaths[0] || null;
  }));
  ipcMain.handle('dialogs:pick-save-file', wrap(async (defaultPath, ext) => {
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultPath || undefined,
      filters: [
        { name: 'Text documents', extensions: ['txt', 'md', 'json', 'xml', 'yaml', 'yml', 'html', 'htm'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return r.canceled ? null : r.filePath || null;
  }));

  ipcMain.handle('editor:read', wrap((p) => {
    const out = fileCore.readTextFile(p);
    getStore().addRecent({ path: p, name: path.basename(p), kind: 'file' });
    return out;
  }));
  ipcMain.handle('editor:write', wrap((p, text) => {
    fileCore.writeTextFile(p, text);
    getStore().addRecent({ path: p, name: path.basename(p), kind: 'file' });
    return p;
  }));
  ipcMain.handle('editor:validate-json', wrap((text) => textCore.validateJson(text)));

  // Generic pickers for the newer modules (filters are main-side, fixed lists).
  ipcMain.handle('dialogs:pick-file', wrap(async (filters) => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: Array.isArray(filters) && filters.length ? filters : [{ name: 'All files', extensions: ['*'] }],
    });
    return r.canceled ? null : r.filePaths[0] || null;
  }));
  ipcMain.handle('dialogs:pick-save-generic', wrap(async (defaultPath, filters) => {
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultPath || undefined,
      filters: Array.isArray(filters) && filters.length ? filters : [{ name: 'All files', extensions: ['*'] }],
    });
    return r.canceled ? null : r.filePath || null;
  }));
  // Binary read as base64 (renderer turns it into a blob URL for <embed> /
  // <img> / <audio> / <video>). Never exposes raw fs to the renderer.
  ipcMain.handle('files:read-base64', wrap((p) => {
    const st = fs.statSync(p);
    if (!st.isFile()) throw new Error('Not a file: ' + p);
    if (st.size > MAX_BINARY_BYTES) throw new Error('File is too large to open here (' + Math.round(st.size / 1048576) + ' MB; limit 200 MB).');
    return { base64: fs.readFileSync(p).toString('base64'), size: st.size, name: path.basename(p) };
  }));
  ipcMain.handle('files:write-base64', wrap((p, base64) => {
    fs.writeFileSync(p, Buffer.from(String(base64 || ''), 'base64'));
    return p;
  }));

  ipcMain.handle('sheet:compute', wrap((grid) => sheetCore.computeGrid(grid)));
  ipcMain.handle('sheet:csv-parse', wrap((text) => sheetCore.csvToGrid(text)));
  ipcMain.handle('sheet:csv-stringify', wrap((grid) => sheetCore.gridToCsv(grid)));
  ipcMain.handle('sheet:sort-rows', wrap((grid, col, dir, hasHeader) => sheetCore.sortGridRows(grid, col, dir, hasHeader)));
  ipcMain.handle('sheet:format-grid', wrap((computed, formats) => (computed || []).map((row, r) => (row || []).map((v, c) => sheetCore.formatCellValue(v, (formats || {})[r + ',' + c] || 'general')))));
  ipcMain.handle('pdf:info', wrap((p) => {
    const buf = fs.readFileSync(p);
    const out = pdfCore.parsePdf(buf);
    return { ...out, size: buf.length, name: path.basename(p) };
  }));
  ipcMain.handle('epub:read', wrap((p) => {
    const buf = fs.readFileSync(p);
    return epubCore.parseEpub(buf);
  }));
  ipcMain.handle('archives:list', wrap((p) => {
    const buf = fs.readFileSync(p);
    return zipCore.listZip(buf).map((e) => ({ name: e.name, method: e.method, size: e.size, compressedSize: e.compressedSize, encrypted: e.encrypted }));
  }));
  ipcMain.handle('archives:create', wrap((filePaths, outPath) => {
    const entries = [];
    for (const fp of filePaths) {
      const st = fs.statSync(fp);
      if (!st.isFile()) throw new Error('Only files can be added to a ZIP (not a folder): ' + fp);
      entries.push({ name: path.basename(fp), data: fs.readFileSync(fp) });
    }
    if (entries.length === 0) throw new Error('No files selected.');
    const buf = zipCore.createZip(entries);
    fs.writeFileSync(outPath, buf);
    return { path: outPath, entries: entries.length, size: buf.length };
  }));
  ipcMain.handle('archives:extract', wrap((zipPath, destDir) => {
    const buf = fs.readFileSync(zipPath);
    const entries = zipCore.listZip(buf);
    let done = 0;
    let renamed = 0;
    const skippedEncrypted = [];
    for (const e of entries) {
      if (e.name.endsWith('/')) continue;
      if (e.encrypted) { skippedEncrypted.push(e.name); continue; }
      const target = zipCore.safeJoin(destDir, e.name);
      if (target === null) {
        throw new Error('Refusing to extract an entry that escapes the folder: ' + e.name);
      }
      const data = zipCore.readEntry(buf, e);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      let finalTarget = target;
      if (fs.existsSync(target)) {
        // Never silently overwrite: clashing files get a numbered name.
        finalTarget = path.join(path.dirname(target), fileCore.uniqueCopyName(path.dirname(target), path.basename(target)));
        renamed += 1;
      }
      fs.writeFileSync(finalTarget, data);
      done += 1;
    }
    return { destDir, entries: done, renamed, skippedEncrypted };
  }));
  ipcMain.handle('archives:extract-selected', wrap((zipPath, destDir, names) => {
    const buf = fs.readFileSync(zipPath);
    const picked = zipCore.extractSelected(buf, names, destDir);
    let renamed = 0;
    for (const e of picked) {
      const target = zipCore.safeJoin(destDir, e.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      let finalTarget = target;
      if (fs.existsSync(target)) {
        finalTarget = path.join(path.dirname(target), fileCore.uniqueCopyName(path.dirname(target), path.basename(target)));
        renamed += 1;
      }
      fs.writeFileSync(finalTarget, e.data);
    }
    return { destDir, entries: picked.length, renamed };
  }));
  // Copy with progress events sent to the renderer as the copy proceeds.
  ipcMain.handle('files:copy-progress', async (event, src, destDir) => {
    try {
      const dest = await fileCore.copyEntryAsync(src, destDir, (prog) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('files:copy-progress', prog);
        }
      });
      return ok(dest);
    } catch (err) { return fail(err); }
  });
  ipcMain.handle('convert:run', wrap((from, to, text) => {
    const r = convertCore.convert(from, to, text);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  }));
  ipcMain.handle('highlight:render', wrap((text, language) => highlightCore.highlightHtml(text, language)));

  ipcMain.handle('settings:get', wrap(() => getStore().get()));
  ipcMain.handle('settings:set', wrap((patch) => getStore().set(patch)));
  ipcMain.handle('settings:add-favourite', wrap((p) => getStore().addFavourite(p)));
  ipcMain.handle('settings:remove-favourite', wrap((p) => getStore().removeFavourite(p)));
  ipcMain.handle('settings:add-recent', wrap((entry) => getStore().addRecent(entry)));
  ipcMain.handle('settings:clear-recents', wrap(() => getStore().clearRecents()));
  ipcMain.handle('settings:clear-cache', wrap(() => {
    const dir = cacheDir();
    let freed = 0;
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        try {
          const st = fs.lstatSync(full);
          if (st.isDirectory()) { freed += fileCore.dirSize(full).size; fs.rmSync(full, { recursive: true, force: false }); }
          else { freed += st.size; fs.unlinkSync(full); }
        } catch { /* one bad cache entry must not block clearing the rest */ }
      }
    } else {
      fs.mkdirSync(dir, { recursive: true });
    }
    return { freedBytes: freed, cacheDir: dir };
  }));

  ipcMain.handle('ui:context-menu', async (_event, kind, payload) => {
    const win = mainWindow;
    if (!win) return ok(null);
    const send = (action) => win.webContents.send('ui:context-action', { ...action, kind, payload });
    let template = [];
    if (kind === 'file') {
      template = [
        { label: 'Open', click: () => send({ action: 'open' }) },
        { type: 'separator' },
        { label: 'Rename…', click: () => send({ action: 'rename' }) },
        { label: 'Duplicate', click: () => send({ action: 'duplicate' }) },
        { label: 'Copy', click: () => send({ action: 'copy' }) },
        { label: 'Cut', click: () => send({ action: 'cut' }) },
        { label: 'Delete…', click: () => send({ action: 'delete' }) },
        { type: 'separator' },
        { label: 'Properties', click: () => send({ action: 'properties' }) },
      ];
      if (payload && payload.isDirectory) {
        template.push({ label: 'Add to favourites', click: () => send({ action: 'favourite' }) });
      }
    } else if (kind === 'blank') {
      template = [
        { label: 'New folder…', click: () => send({ action: 'new-folder' }) },
        { label: 'New text file…', click: () => send({ action: 'new-text' }) },
        { label: 'Paste', click: () => send({ action: 'paste' }) },
      ];
    }
    if (template.length > 0) Menu.buildFromTemplate(template).popup({ window: win });
    return ok(true);
  });
}

function buildMenu() {
  const send = (action) => { if (mainWindow) mainWindow.webContents.send('ui:menu-action', { action }); };
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New text file', accelerator: 'CmdOrCtrl+N', click: () => send('new-text') },
        { label: 'Open folder…', accelerator: 'CmdOrCtrl+O', click: () => send('open-folder') },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Alt+F4', click: () => app.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', click: () => send('redo') },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => send('find') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Files', accelerator: 'CmdOrCtrl+1', click: () => send('view-files') },
        { label: 'Editor', accelerator: 'CmdOrCtrl+2', click: () => send('view-editor') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+3', click: () => send('view-settings') },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About OmSuite',
          click: async () => {
            await dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About OmSuite',
              message: `OmSuite ${VERSION} (Windows core)`,
              detail: 'Everything. One Workspace.\nLocal-first: no account, no cloud, no sync, no telemetry.\nBuild: unsigned development build. See README.md for signing status.',
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'OmSuite',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      allowRunningInsecureContent: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
  if (SMOKE) {
    mainWindow.webContents.on('console-message', (_e, level, message) => {
      // eslint-disable-next-line no-console
      console.log('[renderer console level ' + level + '] ' + message);
    });
    mainWindow.webContents.once('did-finish-load', () => {
      // eslint-disable-next-line no-console
      console.log('SMOKE_OK window loaded');
      setTimeout(() => app.quit(), 1500);
    });
  }
}

app.whenReady().then(() => {
  getStore();
  fs.mkdirSync(cacheDir(), { recursive: true });
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// OmSuite Windows — preload bridge. The renderer runs with nodeIntegration OFF
// and contextIsolation ON; it may only call the narrow API below. It never
// receives raw fs access, shell access, or dialog access beyond these calls.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('omsuite', {
  app: {
    getInfo: () => ipcRenderer.invoke('app:get-info'),
    quit: () => ipcRenderer.invoke('app:quit'),
  },
  files: {
    list: (dir) => ipcRenderer.invoke('files:list', dir),
    createFolder: (parent, name) => ipcRenderer.invoke('files:create-folder', parent, name),
    rename: (entryPath, newName) => ipcRenderer.invoke('files:rename', entryPath, newName),
    copy: (src, destDir) => ipcRenderer.invoke('files:copy', src, destDir),
    copyProgress: (src, destDir) => ipcRenderer.invoke('files:copy-progress', src, destDir),
    move: (src, destDir) => ipcRenderer.invoke('files:move', src, destDir),
    duplicate: (src) => ipcRenderer.invoke('files:duplicate', src),
    delete: (entryPath) => ipcRenderer.invoke('files:delete', entryPath),
    properties: (entryPath) => ipcRenderer.invoke('files:properties', entryPath),
    openPath: (entryPath) => ipcRenderer.invoke('files:open-path', entryPath),
    homeDir: () => ipcRenderer.invoke('files:home-dir'),
  },
  dialogs: {
    pickFolder: () => ipcRenderer.invoke('dialogs:pick-folder'),
    pickFiles: () => ipcRenderer.invoke('dialogs:pick-files'),
    pickTextFile: () => ipcRenderer.invoke('dialogs:pick-text-file'),
    pickSaveFile: (defaultPath, ext) => ipcRenderer.invoke('dialogs:pick-save-file', defaultPath, ext),
    pickFile: (filters) => ipcRenderer.invoke('dialogs:pick-file', filters),
    pickSaveGeneric: (defaultPath, filters) => ipcRenderer.invoke('dialogs:pick-save-generic', defaultPath, filters),
  },
  binary: {
    readBase64: (filePath) => ipcRenderer.invoke('files:read-base64', filePath),
    writeBase64: (filePath, base64) => ipcRenderer.invoke('files:write-base64', filePath, base64),
  },
  sheets: {
    compute: (grid) => ipcRenderer.invoke('sheet:compute', grid),
    csvParse: (text) => ipcRenderer.invoke('sheet:csv-parse', text),
    csvStringify: (grid) => ipcRenderer.invoke('sheet:csv-stringify', grid),
    sortRows: (grid, col, dir, hasHeader) => ipcRenderer.invoke('sheet:sort-rows', grid, col, dir, hasHeader),
    formatGrid: (computed, formats) => ipcRenderer.invoke('sheet:format-grid', computed, formats),
  },
  pdf: { info: (filePath) => ipcRenderer.invoke('pdf:info', filePath) },
  epub: { read: (filePath) => ipcRenderer.invoke('epub:read', filePath) },
  archives: {
    list: (zipPath) => ipcRenderer.invoke('archives:list', zipPath),
    create: (filePaths, outPath) => ipcRenderer.invoke('archives:create', filePaths, outPath),
    extract: (zipPath, destDir) => ipcRenderer.invoke('archives:extract', zipPath, destDir),
    extractSelected: (zipPath, destDir, names) => ipcRenderer.invoke('archives:extract-selected', zipPath, destDir, names),
  },
  convert: { run: (from, to, text) => ipcRenderer.invoke('convert:run', from, to, text) },
  highlight: { render: (text, language) => ipcRenderer.invoke('highlight:render', text, language) },
  editor: {
    read: (filePath) => ipcRenderer.invoke('editor:read', filePath),
    write: (filePath, text) => ipcRenderer.invoke('editor:write', filePath, text),
    validateJson: (text) => ipcRenderer.invoke('editor:validate-json', text),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    addFavourite: (folderPath) => ipcRenderer.invoke('settings:add-favourite', folderPath),
    removeFavourite: (folderPath) => ipcRenderer.invoke('settings:remove-favourite', folderPath),
    addRecent: (entry) => ipcRenderer.invoke('settings:add-recent', entry),
    clearRecents: () => ipcRenderer.invoke('settings:clear-recents'),
    clearCache: () => ipcRenderer.invoke('settings:clear-cache'),
  },
  ui: {
    showContextMenu: (kind, payload) => ipcRenderer.invoke('ui:context-menu', kind, payload),
    onContextAction: (cb) => ipcRenderer.on('ui:context-action', (_e, action) => cb(action)),
    onMenuAction: (cb) => ipcRenderer.on('ui:menu-action', (_e, action) => cb(action)),
    onCopyProgress: (cb) => ipcRenderer.on('files:copy-progress', (_e, prog) => cb(prog)),
  },
});

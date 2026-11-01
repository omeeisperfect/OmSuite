// OmSuite Windows — renderer. No Node access here; every file operation goes
// through window.omsuite (preload) to the main process. No network, no CDN.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = window.omsuite;

  function toast(msg, isError) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }
  function unwrap(res, what) {
    if (!res || !res.ok) throw new Error((what || 'Operation') + ' failed: ' + (res && res.error ? res.error : 'unknown error'));
    return res.value;
  }
  async function call(promise, what) {
    try { return unwrap(await promise, what); }
    catch (err) { toast(err.message, true); throw err; }
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    const u = ['KB', 'MB', 'GB', 'TB'];
    let v = b / 1024, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
    return (v >= 100 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
  }
  function fmtDate(ms) { const d = new Date(ms); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(); }

  // ---------- modal (prompt / confirm / message) ----------
  function showModal(title, bodyHtml, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      $('modal-title').textContent = title;
      $('modal-body').innerHTML = bodyHtml;
      $('modal-ok').textContent = opts.okLabel || 'OK';
      $('modal-cancel').style.display = opts.hideCancel ? 'none' : '';
      $('modal-overlay').classList.remove('hidden');
      const input = $('modal-body').querySelector('input');
      if (input) input.focus();
      const done = (v) => { $('modal-overlay').classList.add('hidden'); resolve(v); };
      $('modal-ok').onclick = () => done(opts.hideCancel ? true : (input ? input.value : true));
      $('modal-cancel').onclick = () => done(null);
      $('modal-overlay').onclick = (e) => { if (e.target === $('modal-overlay')) done(null); };
    });
  }
  function promptModal(title, label, defVal) {
    return showModal(title, '<label>' + esc(label) + '<input type="text" value="' + esc(defVal || '') + '"></label>');
  }
  function confirmModal(title, message) {
    return showModal(title, '<p>' + esc(message) + '</p>', { okLabel: 'Yes, continue' }).then((v) => v !== null);
  }

  // ---------- state ----------
  let settings = null;
  let currentDir = '';
  let entries = [];
  let selected = new Set();
  let lastClickedIndex = -1;
  let clipboard = null; // { paths, mode: 'copy' | 'cut' }
  let backStack = [];
  let fwdStack = [];
  let viewMode = 'list';
  let sortKey = 'name';
  let sortDir = 'asc';

  // ---------- theme / views ----------
  function applyTheme() {
    if (!settings) return;
    let t = settings.theme;
    if (t === 'system') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    document.querySelectorAll('input[name="theme"]').forEach((r) => { r.checked = (r.value === settings.theme); });
  }
  async function switchView(view) {
    if (view !== 'editor' && editorDirty()) {
      const keep = await confirmModal('Unsaved changes', 'The Editor has unsaved changes. Switch away and discard them?');
      if (!keep) return;
      editorDiscard();
    }
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $('view-' + view).classList.add('active');
    const viewNames = { home: 'Home', files: 'Files', editor: 'Editor', sheets: 'Sheets', slides: 'Slides', pdf: 'PDF Studio', media: 'Media', ebooks: 'E-books', archives: 'Archives', converter: 'Converter', scan: 'Scan & OCR', code: 'Code', settings: 'Settings' };
    const gs = $('global-status');
    if (gs) gs.textContent = 'OmSuite · ' + (viewNames[view] || view) + ' · local only. No account, no cloud, no telemetry.';
    if (view === 'home') renderHome();
    if (view === 'files') renderFiles();
  }
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (settings && settings.theme === 'system') applyTheme(); });

  // ---------- sidebar resize ----------
  (function () {
    const resizer = $('sidebar-resizer');
    const sidebar = $('sidebar');
    let dragging = false;
    resizer.addEventListener('mousedown', (e) => { dragging = true; e.preventDefault(); });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const w = Math.max(180, Math.min(480, e.clientX));
      sidebar.style.width = w + 'px';
    });
    window.addEventListener('mouseup', async () => {
      if (!dragging) return;
      dragging = false;
      const w = parseInt(sidebar.style.width, 10);
      if (settings && w) { settings = await call(api.settings.set({ sidebarWidth: w }), 'Save sidebar width'); }
    });
  })();

  // ---------- home / favourites / recents ----------
  async function renderFavs() {
    const list = $('fav-list');
    if (!settings || settings.favourites.length === 0) {
      list.innerHTML = '<p class="muted">No favourites yet. Right-click a folder → Add to favourites.</p>';
      return;
    }
    list.innerHTML = '';
    settings.favourites.forEach((f) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '4px';
      const b = document.createElement('button');
      b.textContent = '📁 ' + f;
      b.title = f;
      b.style.flex = '1';
      b.addEventListener('click', () => { switchView('files'); navigate(f); });
      const rm = document.createElement('button');
      rm.textContent = '✕';
      rm.title = 'Remove from favourites';
      rm.addEventListener('click', async (e) => {
        e.stopPropagation();
        settings = await call(api.settings.removeFavourite(f), 'Remove favourite');
        renderFavs();
      });
      row.appendChild(b);
      row.appendChild(rm);
      list.appendChild(row);
    });
  }
  async function renderHome() {
    const list = $('recent-list');
    if (!settings || !settings.recentsEnabled || settings.recents.length === 0) {
      list.innerHTML = '<p class="muted">Nothing opened yet.</p>';
      return;
    }
    list.innerHTML = '';
    settings.recents.forEach((r) => {
      const b = document.createElement('button');
      b.textContent = (r.kind === 'folder' ? '📁 ' : '📝 ') + r.name;
      b.title = r.path;
      b.addEventListener('click', async () => {
        if (r.kind === 'folder') { switchView('files'); navigate(r.path); }
        else { await openInEditor(r.path); }
      });
      list.appendChild(b);
    });
    renderFavs();
  }
  $('home-new-text').addEventListener('click', () => { switchView('editor'); editorNew(); });
  $('home-open-folder').addEventListener('click', async () => {
    const dir = await call(api.dialogs.pickFolder(), 'Open folder');
    if (dir) {
      switchView('files'); navigate(dir);
      try { const s = await api.settings.addRecent({ path: dir, name: dir, kind: 'folder' }); if (s.ok) settings = s.value; } catch (e) { /* best-effort */ }
    }
  });
  $('home-open-file').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickTextFile(), 'Open file');
    if (f) await openInEditor(f);
  });

  // ---------- file manager ----------
  function visibleEntries() {
    const q = $('search-input').value.trim().toLowerCase();
    let list = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : [...entries];
    const dir = sortDir === 'desc' ? -1 : 1;
    list.sort((a, b) => {
      if (sortKey === 'name' && a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      if (sortKey === 'size') return (a.size - b.size) * dir;
      if (sortKey === 'date') return (a.mtimeMs - b.mtimeMs) * dir;
      if (sortKey === 'type') {
        const t = (a.extension || '').localeCompare(b.extension || '');
        return t !== 0 ? t * dir : a.name.localeCompare(b.name) * dir;
      }
      return a.name.localeCompare(b.name) * dir;
    });
    return list;
  }

  async function navigate(dir, pushHistory) {
    if (!dir) return;
    let res;
    try { res = await api.files.list(dir); } catch (err) { toast(err.message || String(err), true); return; }
    if (!res.ok) { toast('Cannot open folder: ' + res.error, true); return; }
    if (pushHistory !== false && currentDir && currentDir !== dir) { backStack.push(currentDir); fwdStack = []; }
    currentDir = dir;
    entries = res.value.entries;
    selected = new Set();
    lastClickedIndex = -1;
    $('path-input').value = dir;
    renderBreadcrumbs();
    renderFiles();
    try { settings = await api.settings.get().then((r) => (r.ok ? r.value : settings)); } catch (e) { /* recents refresh is best-effort */ }
  }

  function renderBreadcrumbs() {
    const nav = $('breadcrumbs');
    nav.innerHTML = '';
    if (!currentDir) return;
    const parts = currentDir.split(/[\\/]/).filter(Boolean);
    const isWin = /^[A-Za-z]:/.test(currentDir);
    const crumbs = [];
    if (isWin) crumbs.push({ name: parts[0] + '\\', path: parts[0] + '\\' });
    else crumbs.push({ name: '/', path: '/' });
    let acc = crumbs[0].path;
    parts.slice(isWin ? 1 : 0).forEach((p) => {
      acc = acc.endsWith('\\') || acc.endsWith('/') ? acc + p : acc + '/' + p;
      crumbs.push({ name: p, path: acc });
    });
    crumbs.forEach((c, i) => {
      const b = document.createElement('button');
      b.textContent = c.name;
      b.addEventListener('click', () => navigate(c.path));
      nav.appendChild(b);
      if (i < crumbs.length - 1) { const s = document.createElement('span'); s.textContent = '›'; nav.appendChild(s); }
    });
  }

  function renderFiles() {
    const list = visibleEntries();
    const area = $('file-list');
    area.className = viewMode;
    area.innerHTML = '';
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const msg = entries.length === 0 ? 'This folder is empty.' : 'No files match the filter.';
      empty.innerHTML = '<div>' + esc(msg) + '</div>';
      if (entries.length === 0) {
        const b1 = document.createElement('button'); b1.textContent = '＋ New folder';
        b1.addEventListener('click', newFolder);
        const b2 = document.createElement('button'); b2.textContent = '＋ New text file';
        b2.addEventListener('click', () => newTextFileHere());
        empty.appendChild(b1); empty.appendChild(b2);
      }
      area.appendChild(empty);
    } else if (viewMode === 'details') {
      const table = document.createElement('table');
      table.innerHTML = '<tr><th>Name</th><th>Type</th><th>Size</th><th>Modified</th></tr>';
      list.forEach((e, i) => {
        const tr = document.createElement('tr');
        if (selected.has(e.path)) tr.classList.add('selected');
        tr.innerHTML = '<td>' + (e.isDirectory ? '📁 ' : e.isSymlink ? '🔗 ' : '📄 ') + esc(e.name) + '</td><td>' + (e.isDirectory ? 'Folder' : (e.extension || 'File')) + '</td><td>' + (e.isDirectory ? '—' : fmtSize(e.size)) + '</td><td>' + fmtDate(e.mtimeMs) + '</td>';
        bindRow(tr, e, i);
        table.appendChild(tr);
      });
      area.appendChild(table);
    } else {
      list.forEach((e, i) => {
        const el = document.createElement('div');
        el.className = (viewMode === 'grid' ? 'card-item' : 'row') + (selected.has(e.path) ? ' selected' : '');
        el.draggable = true;
        if (viewMode === 'grid') {
          el.innerHTML = '<span class="fname">' + (e.isDirectory ? '📁 ' : '📄 ') + esc(e.name) + '</span><span class="fmeta">' + (e.isDirectory ? 'Folder' : fmtSize(e.size)) + '</span>';
        } else {
          el.innerHTML = '<span class="fname">' + (e.isDirectory ? '📁 ' : e.isSymlink ? '🔗 ' : '📄 ') + esc(e.name) + '</span><span class="fmeta">' + (e.isDirectory ? 'Folder' : fmtSize(e.size)) + ' · ' + fmtDate(e.mtimeMs) + '</span>';
        }
        bindRow(el, e, i);
        area.appendChild(el);
      });
    }
    const total = entries.filter((e) => !e.isDirectory).reduce((s, e) => s + e.size, 0);
    $('file-status').textContent = entries.length + ' item(s) · ' + selected.size + ' selected · ' + fmtSize(total) + ' in files';
  }

  function bindRow(el, entry, index) {
    el.addEventListener('click', (e) => {
      const vis = visibleEntries();
      if (e.shiftKey && lastClickedIndex >= 0) {
        const a = Math.min(lastClickedIndex, index), b = Math.max(lastClickedIndex, index);
        for (let k = a; k <= b; k += 1) selected.add(vis[k].path);
      } else if (e.ctrlKey || e.metaKey) {
        if (selected.has(entry.path)) selected.delete(entry.path); else selected.add(entry.path);
        lastClickedIndex = index;
      } else {
        selected = new Set([entry.path]);
        lastClickedIndex = index;
      }
      renderFiles();
    });
    el.addEventListener('dblclick', () => openEntry(entry));
    el.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      if (!selected.has(entry.path)) { selected = new Set([entry.path]); renderFiles(); }
      await api.ui.showContextMenu('file', { path: entry.path, isDirectory: entry.isDirectory });
    });
    el.addEventListener('dragstart', (e) => {
      const paths = selected.has(entry.path) ? [...selected] : [entry.path];
      e.dataTransfer.setData('text/omsuite-paths', JSON.stringify(paths));
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragover', (e) => { if (entry.isDirectory) e.preventDefault(); });
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!entry.isDirectory) return;
      const raw = e.dataTransfer.getData('text/omsuite-paths');
      if (raw) {
        const paths = JSON.parse(raw);
        for (const p of paths) { try { await call(api.files.move(p, entry.path), 'Move'); } catch (err) { break; } }
        navigate(currentDir, false);
      }
    });
  }

  async function openEntry(entry) {
    if (entry.isDirectory) {
      navigate(entry.path);
      try {
        const s = await api.settings.addRecent({ path: entry.path, name: entry.name, kind: 'folder' });
        if (s.ok) settings = s.value;
      } catch (e) { /* best-effort */ }
      return;
    }
    const ext = (entry.extension || '').toLowerCase();
    if (['.txt', '.md', '.json', '.xml', '.yaml', '.yml', '.html', '.htm'].includes(ext)) {
      await openInEditor(entry.path);
    } else {
      await call(api.files.openPath(entry.path), 'Open file');
    }
  }

  async function newFolder() {
    const name = await promptModal('New folder', 'Folder name', 'New folder');
    if (name === null) return;
    try {
      await call(api.files.createFolder(currentDir, name), 'Create folder');
      toast('Folder created: ' + name);
      navigate(currentDir, false);
    } catch (e) { /* already toasted */ }
  }
  async function newTextFileHere() {
    const name = await promptModal('New text file', 'File name (include .txt, .md, .json …)', 'Untitled.txt');
    if (name === null) return;
    const full = currentDir.replace(/[\\/]$/, '') + '/' + name;
    try {
      await call(api.editor.write(full, ''), 'Create file');
      toast('File created: ' + name);
      navigate(currentDir, false);
      await openInEditor(full);
    } catch (e) { /* already toasted */ }
  }
  async function renameSelected() {
    const paths = [...selected];
    if (paths.length !== 1) { toast('Select exactly one item to rename.', true); return; }
    const entry = entries.find((e) => e.path === paths[0]);
    const name = await promptModal('Rename', 'New name', entry ? entry.name : '');
    if (name === null) return;
    try {
      await call(api.files.rename(paths[0], name), 'Rename');
      navigate(currentDir, false);
    } catch (e) { /* already toasted */ }
  }
  async function deleteSelected() {
    const paths = [...selected];
    if (paths.length === 0) { toast('Nothing selected.', true); return; }
    const okDel = await confirmModal('Delete permanently?', paths.length + ' item(s) will be permanently deleted. This cannot be undone from OmSuite.');
    if (!okDel) return;
    let done = 0;
    for (const p of paths) {
      try { await call(api.files.delete(p), 'Delete'); done += 1; } catch (e) { break; }
    }
    toast('Deleted ' + done + ' of ' + paths.length + ' item(s).');
    navigate(currentDir, false);
  }
  async function pasteClipboard() {
    if (!clipboard || clipboard.paths.length === 0) { toast('Clipboard is empty. Copy or Cut something first.'); return; }
    let done = 0;
    $('copy-progress').classList.remove('hidden');
    for (const p of clipboard.paths) {
      try {
        if (clipboard.mode === 'copy') await call(api.files.copyProgress(p, currentDir), 'Copy');
        else await call(api.files.move(p, currentDir), 'Move');
        done += 1;
      } catch (e) { break; }
    }
    $('copy-progress').classList.add('hidden');
    if (clipboard.mode === 'cut') clipboard = null;
    toast('Pasted ' + done + ' item(s).');
    navigate(currentDir, false);
  }
  api.ui.onCopyProgress((prog) => {
    const pct = prog.totalBytes > 0 ? Math.round((prog.doneBytes / prog.totalBytes) * 100)
      : (prog.totalFiles > 0 ? Math.round((prog.doneFiles / prog.totalFiles) * 100) : 0);
    $('copy-bar').value = pct;
    $('copy-progress-text').textContent = 'Copying ' + (prog.current || '') + ' — ' + prog.doneFiles + '/' + prog.totalFiles + ' files (' + pct + '%)';
  });
  async function showProperties(entryPath) {
    try {
      const st = await call(api.files.properties(entryPath), 'Properties');
      let body = '<p><strong>Name:</strong> ' + esc(st.name) + '</p><p><strong>Path:</strong> ' + esc(st.path) + '</p>';
      body += '<p><strong>Type:</strong> ' + (st.isDirectory ? 'Folder' : st.isSymlink ? 'Shortcut / symlink' : 'File') + '</p>';
      body += '<p><strong>Modified:</strong> ' + fmtDate(st.mtimeMs) + '</p>';
      if (st.isDirectory && st.dirSize) {
        body += '<p><strong>Contents size:</strong> ' + fmtSize(st.dirSize.size) + ' (' + st.dirSize.files + ' files, ' + st.dirSize.dirs + ' folders' + (st.dirSize.truncated ? ', counting stopped at the limit' : '') + ')</p>';
      } else if (st.isFile) {
        body += '<p><strong>Size:</strong> ' + fmtSize(st.size) + '</p>';
      }
      await showModal('Properties', body, { hideCancel: true, okLabel: 'Close' });
    } catch (e) { /* already toasted */ }
  }

  $('btn-back').addEventListener('click', () => { if (backStack.length) { fwdStack.push(currentDir); navigate(backStack.pop(), false); } });
  $('btn-forward').addEventListener('click', () => { if (fwdStack.length) { backStack.push(currentDir); navigate(fwdStack.pop(), false); } });
  $('btn-up').addEventListener('click', () => {
    if (!currentDir) return;
    const parent = currentDir.replace(/[\\/][^\\/]*[\\/]?$/, '') || currentDir;
    if (parent !== currentDir) navigate(parent);
  });
  $('btn-go').addEventListener('click', () => navigate($('path-input').value.trim()));
  $('path-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate($('path-input').value.trim()); });
  $('search-input').addEventListener('input', renderFiles);
  $('sort-select').addEventListener('change', (e) => {
    const parts = e.target.value.split('-');
    sortKey = parts[0]; sortDir = parts[1] || 'asc';
    renderFiles();
  });
  $('view-select').addEventListener('change', (e) => { viewMode = e.target.value; renderFiles(); });
  $('btn-new-folder').addEventListener('click', newFolder);
  $('btn-new-text-file').addEventListener('click', newTextFileHere);
  $('btn-copy-here').addEventListener('click', async () => {
    const files = await call(api.dialogs.pickFiles(), 'Choose files');
    if (!files || files.length === 0) return;
    let done = 0;
    $('copy-progress').classList.remove('hidden');
    for (const f of files) { try { await call(api.files.copyProgress(f, currentDir), 'Copy here'); done += 1; } catch (e) { break; } }
    $('copy-progress').classList.add('hidden');
    toast('Copied ' + done + ' of ' + files.length + ' file(s) here.');
    navigate(currentDir, false);
  });
  $('btn-copy-sel').addEventListener('click', () => { if (selected.size) { clipboard = { paths: [...selected], mode: 'copy' }; toast('Copied ' + selected.size + ' item(s).'); } });
  $('btn-cut-sel').addEventListener('click', () => { if (selected.size) { clipboard = { paths: [...selected], mode: 'cut' }; toast('Cut ' + selected.size + ' item(s).'); } });
  $('btn-paste').addEventListener('click', pasteClipboard);
  $('btn-delete-sel').addEventListener('click', deleteSelected);
  $('file-area').addEventListener('contextmenu', async (e) => {
    if (e.target.closest('.row, .card-item, tr')) return; // row menu handles itself
    e.preventDefault();
    await api.ui.showContextMenu('blank', { dir: currentDir });
  });
  $('file-area').addEventListener('dragover', (e) => e.preventDefault());
  $('file-area').addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer.files || [])].map((f) => f.path).filter(Boolean);
    if (files.length === 0) return;
    let done = 0;
    $('copy-progress').classList.remove('hidden');
    for (const f of files) { try { await call(api.files.copyProgress(f, currentDir), 'Copy here'); done += 1; } catch (err) { break; } }
    $('copy-progress').classList.add('hidden');
    toast('Copied ' + done + ' of ' + files.length + ' dropped file(s) here.');
    navigate(currentDir, false);
  });
  $('file-area').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selected = new Set(visibleEntries().map((x) => x.path));
      renderFiles();
    } else if (e.key === 'Delete') { deleteSelected(); }
    else if (e.key === 'F2') { renameSelected(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { if (selected.size) clipboard = { paths: [...selected], mode: 'copy' }; }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') { if (selected.size) clipboard = { paths: [...selected], mode: 'cut' }; }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { pasteClipboard(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('search-input').focus(); }
  });
  api.ui.onContextAction(async (a) => {
    const target = a.payload && a.payload.path ? a.payload.path : null;
    if (a.action === 'open' && target) {
      const entry = entries.find((e) => e.path === target);
      if (entry) await openEntry(entry);
    } else if (a.action === 'rename') { selected = new Set([target]); await renameSelected(); }
    else if (a.action === 'duplicate' && target) { await call(api.files.duplicate(target), 'Duplicate'); navigate(currentDir, false); }
    else if (a.action === 'copy' && target) { clipboard = { paths: [...selected], mode: 'copy' }; toast('Copied.'); }
    else if (a.action === 'cut' && target) { clipboard = { paths: [...selected], mode: 'cut' }; toast('Cut.'); }
    else if (a.action === 'delete') { await deleteSelected(); }
    else if (a.action === 'properties' && target) { await showProperties(target); }
    else if (a.action === 'favourite' && target) {
      settings = await call(api.settings.addFavourite(target), 'Add favourite');
      renderFavs(); toast('Added to favourites.');
    } else if (a.action === 'new-folder') { await newFolder(); }
    else if (a.action === 'new-text') { await newTextFileHere(); }
    else if (a.action === 'paste') { await pasteClipboard(); }
  });

  // ---------- editor ----------
  let edPath = null;
  let edSavedText = '';
  let edHistPast = [];
  let edHistFuture = [];
  let edLastCommitted = '';
  let edCommitTimer = null;
  let edFindMatches = [];
  let edFindIndex = -1;
  let edPreviewOn = false;

  function edTextEl() { return $('ed-text'); }
  function editorDirty() {
    if (!$('view-editor').classList.contains('active') && edPath === null && edTextEl().value === '' && edSavedText === '') return false;
    return edTextEl().value !== edSavedText;
  }
  function editorDiscard() { edSavedText = edTextEl().value; updateEditorChrome(); }
  function flushCommit() {
    if (edCommitTimer) { clearTimeout(edCommitTimer); edCommitTimer = null; }
    const cur = edTextEl().value;
    if (cur !== edLastCommitted) {
      edHistPast.push(edLastCommitted);
      if (edHistPast.length > 200) edHistPast.shift();
      edHistFuture = [];
      edLastCommitted = cur;
    }
  }
  function updateEditorChrome() {
    const ta = edTextEl();
    $('ed-path').textContent = edPath || 'Untitled — not saved yet';
    $('ed-dirty').textContent = editorDirty() ? '● unsaved' : '';
    $('ed-save').disabled = !editorDirty();
    $('ed-undo').disabled = edHistPast.length === 0;
    $('ed-redo').disabled = edHistFuture.length === 0;
    const text = ta.value;
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    const lines = text === '' ? 0 : text.split('\n').length;
    const before = text.slice(0, ta.selectionStart || 0).split('\n');
    $('ed-status').textContent = lines + ' lines · ' + words + ' words · ' + text.length + ' characters · Ln ' + before.length + ', Col ' + (before[before.length - 1].length + 1);
    if (edPreviewOn) $('ed-preview').innerHTML = window.OMMarkdown.renderMarkdown(text);
    updateFindCount();
  }
  function updateFindCount() {
    $('find-count').textContent = edFindMatches.length === 0 ? 'No matches' : (edFindIndex + 1) + ' of ' + edFindMatches.length;
  }
  function computeFind() {
    const q = $('find-input').value;
    const text = edTextEl().value;
    edFindMatches = [];
    edFindIndex = -1;
    if (q === '') { updateFindCount(); return; }
    const cs = $('find-case').checked;
    const hay = cs ? text : text.toLowerCase();
    const needle = cs ? q : q.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1) { edFindMatches.push(i); i = hay.indexOf(needle, i + Math.max(needle.length, 1)); }
    if (edFindMatches.length) { edFindIndex = 0; gotoMatch(0); }
    updateFindCount();
  }
  function gotoMatch(idx) {
    if (edFindMatches.length === 0) return;
    edFindIndex = ((idx % edFindMatches.length) + edFindMatches.length) % edFindMatches.length;
    const pos = edFindMatches[edFindIndex];
    const ta = edTextEl();
    ta.focus();
    ta.setSelectionRange(pos, pos + $('find-input').value.length);
    updateFindCount();
  }
  function openInEditor(filePath) {
    return (async () => {
      if (editorDirty()) {
        const keep = await confirmModal('Unsaved changes', 'The Editor has unsaved changes. Open another file and discard them?');
        if (!keep) return;
      }
      try {
        const out = await call(api.editor.read(filePath), 'Open file');
        edPath = filePath;
        edSavedText = out.text;
        edLastCommitted = out.text;
        edHistPast = []; edHistFuture = [];
        edTextEl().value = out.text;
        await switchView('editor');
        updateEditorChrome();
        const draft = edReadDraft();
        if (draft && draft.path === filePath && draft.text !== out.text) {
          const restore = await confirmModal('Unsaved draft found', 'An unsaved draft of this file was recovered from the last session. Restore the draft instead of the saved file?');
          if (restore) {
            edTextEl().value = draft.text;
            edLastCommitted = draft.text;
            updateEditorChrome();
            toast('Draft restored — save to keep it.');
          } else {
            edClearDraft();
          }
        }
        if (filePath.toLowerCase().endsWith('.json')) await validateJsonShow();
        else $('ed-json-status').textContent = '';
      } catch (e) { /* already toasted */ }
    })();
  }
  function editorNew() {
    (async () => {
      if (editorDirty()) {
        const keep = await confirmModal('Unsaved changes', 'Start a new file and discard unsaved changes?');
        if (!keep) return;
      }
      edPath = null; edSavedText = ''; edLastCommitted = '';
      edHistPast = []; edHistFuture = [];
      edTextEl().value = '';
      updateEditorChrome();
    })();
  }
  async function editorSave() {
    if (!edPath) { await editorSaveAs(); return; }
    try {
      await call(api.editor.write(edPath, edTextEl().value), 'Save');
      edSavedText = edTextEl().value;
      edLastCommitted = edTextEl().value;
      edClearDraft();
      toast('Saved.');
      updateEditorChrome();
    } catch (e) { /* already toasted */ }
  }
  async function editorSaveAs() {
    let def = edPath;
    if (!def && settings && settings.defaultSaveLocation) def = settings.defaultSaveLocation.replace(/[\\/]$/, '') + '/Untitled.txt';
    const target = await call(api.dialogs.pickSaveFile(def || undefined), 'Save as');
    if (!target) return;
    try {
      await call(api.editor.write(target, edTextEl().value), 'Save as');
      edPath = target;
      edSavedText = edTextEl().value;
      edLastCommitted = edTextEl().value;
      edClearDraft();
      toast('Saved as ' + target);
      updateEditorChrome();
    } catch (e) { /* already toasted */ }
  }
  async function validateJsonShow() {
    const res = await api.editor.validateJson(edTextEl().value);
    if (!res.ok) { $('ed-json-status').textContent = 'Validation error: ' + res.error; return; }
    $('ed-json-status').textContent = res.value.ok ? 'JSON is valid.' : 'JSON is not valid: ' + res.value.error;
  }
  edTextEl().addEventListener('input', () => {
    if (edCommitTimer) clearTimeout(edCommitTimer);
    edCommitTimer = setTimeout(flushCommit, 400);
    if (edDraftTimer) clearTimeout(edDraftTimer);
    edDraftTimer = setTimeout(edSaveDraft, 1000);
    updateEditorChrome();
  });
  edTextEl().addEventListener('keyup', updateEditorChrome);
  edTextEl().addEventListener('click', updateEditorChrome);
  $('ed-new').addEventListener('click', editorNew);
  $('ed-open').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickTextFile(), 'Open file');
    if (f) await openInEditor(f);
  });
  $('ed-save').addEventListener('click', editorSave);
  $('ed-save-as').addEventListener('click', editorSaveAs);
  $('ed-undo').addEventListener('click', () => {
    flushCommit();
    if (!edHistPast.length) return;
    edHistFuture.push(edTextEl().value);
    const prev = edHistPast.pop();
    edTextEl().value = prev; edLastCommitted = prev;
    updateEditorChrome();
  });
  $('ed-redo').addEventListener('click', () => {
    flushCommit();
    if (!edHistFuture.length) return;
    edHistPast.push(edTextEl().value);
    const next = edHistFuture.pop();
    edTextEl().value = next; edLastCommitted = next;
    updateEditorChrome();
  });
  $('ed-find-toggle').addEventListener('click', () => {
    $('ed-findbar').classList.toggle('hidden');
    if (!$('ed-findbar').classList.contains('hidden')) $('find-input').focus();
  });
  // ---------- formatting toolbar (real Markdown edits in the textarea) ----------
  function edApply(fn) {
    const ta = edTextEl();
    ta.focus();
    fn(ta);
    flushCommit();
    updateEditorChrome();
  }
  function edWrap(before, after) {
    edApply((ta) => {
      const s = ta.selectionStart, e = ta.selectionEnd;
      const sel = ta.value.slice(s, e);
      ta.setRangeText(before + sel + after, s, e + before.length + after.length, 'end');
      if (s === e) ta.setSelectionRange(s + before.length, s + before.length);
      else ta.setSelectionRange(s, e + before.length + after.length);
    });
  }
  function edPrefixLines(prefixFn) {
    edApply((ta) => {
      const s = ta.selectionStart, e = ta.selectionEnd;
      const startLine = ta.value.lastIndexOf('\n', s - 1) + 1;
      const endLine = e === s ? s : ta.value.indexOf('\n', e);
      const end = endLine === -1 ? ta.value.length : endLine;
      const block = ta.value.slice(startLine, end);
      const lines = block.split('\n');
      const out = lines.map((ln, i) => prefixFn(ln, i)).join('\n');
      ta.setRangeText(out, startLine, end, 'end');
      ta.setSelectionRange(startLine, startLine + out.length);
    });
  }
  $('ed-bold').addEventListener('click', () => edWrap('**', '**'));
  $('ed-italic').addEventListener('click', () => edWrap('*', '*'));
  $('ed-heading').addEventListener('click', () => edPrefixLines((ln) => ln.startsWith('# ') ? ln.slice(2) : '# ' + ln));
  $('ed-list').addEventListener('click', () => edPrefixLines((ln) => ln.startsWith('- ') ? ln : '- ' + ln));
  $('ed-numlist').addEventListener('click', () => edPrefixLines((ln, i) => /^\d+\. /.test(ln) ? ln : (i + 1) + '. ' + ln));
  // ---------- autosave draft recovery (localStorage, this PC only) ----------
  const ED_DRAFT_KEY = 'omsuite-editor-draft';
  let edDraftTimer = null;
  function edSaveDraft() {
    try {
      const text = edTextEl().value;
      if (text === edSavedText) { try { localStorage.removeItem(ED_DRAFT_KEY); } catch (e) { /* storage unavailable */ } $('ed-draft-note').textContent = ''; return; }
      localStorage.setItem(ED_DRAFT_KEY, JSON.stringify({ path: edPath, text, at: Date.now() }));
      $('ed-draft-note').textContent = '· draft saved locally';
    } catch (e) { /* storage unavailable: drafting is best-effort */ }
  }
  function edReadDraft() {
    try {
      const raw = localStorage.getItem(ED_DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function edClearDraft() { try { localStorage.removeItem(ED_DRAFT_KEY); } catch (e) { /* ignore */ } }
  $('find-input').addEventListener('input', computeFind);
  $('find-case').addEventListener('change', computeFind);
  $('find-next').addEventListener('click', () => gotoMatch(edFindIndex + 1));
  $('find-prev').addEventListener('click', () => gotoMatch(edFindIndex - 1));
  $('replace-one').addEventListener('click', () => {
    if (edFindMatches.length === 0) { computeFind(); }
    if (edFindMatches.length === 0) return;
    const ta = edTextEl();
    const q = $('find-input').value;
    const pos = edFindMatches[edFindIndex];
    if (ta.selectionStart !== pos) { gotoMatch(edFindIndex); return; }
    ta.setRangeText($('replace-input').value, pos, pos + q.length, 'end');
    flushCommit(); updateEditorChrome(); computeFind();
  });
  $('replace-all').addEventListener('click', () => {
    const q = $('find-input').value;
    if (!q) return;
    const ta = edTextEl();
    const cs = $('find-case').checked;
    const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), cs ? 'g' : 'gi');
    const before = ta.value;
    const count = (before.match(pattern) || []).length;
    ta.value = before.replace(pattern, $('replace-input').value);
    flushCommit(); updateEditorChrome(); computeFind();
    toast('Replaced ' + count + ' occurrence(s).');
  });
  $('ed-validate').addEventListener('click', validateJsonShow);
  $('ed-format-json').addEventListener('click', async () => {
    const res = await api.editor.validateJson(edTextEl().value);
    if (!res.ok || !res.value.ok) { $('ed-json-status').textContent = 'Cannot format: ' + (res.ok ? res.value.error : res.error); return; }
    edTextEl().value = res.value.formatted;
    flushCommit(); updateEditorChrome();
    $('ed-json-status').textContent = 'JSON formatted.';
  });
  $('ed-preview-toggle').addEventListener('click', () => {
    edPreviewOn = !edPreviewOn;
    $('ed-preview').classList.toggle('hidden', !edPreviewOn);
    $('ed-preview-toggle').textContent = edPreviewOn ? '✕ Hide preview' : '👁 Preview';
    if (edPreviewOn) updateEditorChrome();
  });
  document.addEventListener('keydown', (e) => {
    if (!$('view-editor').classList.contains('active')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); editorSave(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $('ed-undo').click(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); $('ed-redo').click(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('ed-findbar').classList.remove('hidden'); $('find-input').focus(); }
  });

  // ---------- settings view ----------
  async function renderSettings() {
    if (!settings) return;
    document.querySelectorAll('input[name="theme"]').forEach((r) => { r.checked = (r.value === settings.theme); });
    $('set-save-location').value = settings.defaultSaveLocation || '';
    $('set-recents-enabled').checked = !!settings.recentsEnabled;
    $('set-recents-max').value = settings.recentsMax;
    try {
      const info = await call(api.app.getInfo(), 'App info');
      $('about-lines').textContent = 'OmSuite ' + info.version + ' · App ID ' + info.appId + ' · Build: unsigned (see README.md) · Data folder: ' + info.userDataDir;
    } catch (e) { /* best-effort */ }
  }
  document.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener('change', async () => {
    settings = await call(api.settings.set({ theme: r.value }), 'Save theme');
    applyTheme();
  }));
  $('set-browse-location').addEventListener('click', async () => {
    const dir = await call(api.dialogs.pickFolder(), 'Choose default save location');
    if (dir) {
      settings = await call(api.settings.set({ defaultSaveLocation: dir }), 'Save location');
      $('set-save-location').value = dir;
      toast('Default save location saved.');
    }
  });
  $('set-clear-location').addEventListener('click', async () => {
    settings = await call(api.settings.set({ defaultSaveLocation: '' }), 'Clear location');
    $('set-save-location').value = '';
  });
  $('set-save-location').addEventListener('change', async (e) => {
    settings = await call(api.settings.set({ defaultSaveLocation: e.target.value.trim() }), 'Save location');
  });
  $('set-recents-enabled').addEventListener('change', async (e) => {
    settings = await call(api.settings.set({ recentsEnabled: e.target.checked }), 'Save history setting');
    renderHome();
  });
  $('set-recents-max').addEventListener('change', async (e) => {
    const v = Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0));
    e.target.value = v;
    settings = await call(api.settings.set({ recentsMax: v }), 'Save history limit');
    renderHome();
  });
  $('set-clear-recents').addEventListener('click', async () => {
    settings = await call(api.settings.clearRecents(), 'Clear recents');
    renderHome(); toast('Recent history cleared.');
  });
  $('set-clear-cache').addEventListener('click', async () => {
    const out = await call(api.settings.clearCache(), 'Clear cache');
    $('cache-result').textContent = 'Cleared ' + fmtSize(out.freedBytes) + ' from ' + out.cacheDir;
  });

  // ---------- menu actions from main ----------
  api.ui.onMenuAction(async (a) => {
    if (a.action === 'new-text') { await switchView('editor'); editorNew(); }
    else if (a.action === 'open-folder') {
      const dir = await call(api.dialogs.pickFolder(), 'Open folder');
      if (dir) {
        await switchView('files'); navigate(dir);
        try { const s = await api.settings.addRecent({ path: dir, name: dir, kind: 'folder' }); if (s.ok) settings = s.value; } catch (e) { /* best-effort */ }
      }
    } else if (a.action === 'undo') { if ($('view-editor').classList.contains('active')) $('ed-undo').click(); }
    else if (a.action === 'redo') { if ($('view-editor').classList.contains('active')) $('ed-redo').click(); }
    else if (a.action === 'find') {
      await switchView('editor');
      $('ed-findbar').classList.remove('hidden'); $('find-input').focus();
    } else if (a.action === 'view-files') { await switchView('files'); }
    else if (a.action === 'view-editor') { await switchView('editor'); }
    else if (a.action === 'view-settings') { await switchView('settings'); renderSettings(); }
  });

  // ---------- shared helper for new modules ----------
  function b64ToBlobUrl(base64, mime) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
  }
  function mimeFor(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    const map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska' };
    return map[ext] || 'application/octet-stream';
  }

  // ---------- sheets ----------
  let shSheets = [{ name: 'Sheet1', grid: [], formats: {}, colWidths: [] }];
  let shSheetIndex = 0;
  let shGrid = shSheets[0].grid;
  let shFormats = shSheets[0].formats;
  let shColWidths = shSheets[0].colWidths;
  let shComputed = [];
  let shFormatted = [];
  let shSel = { r: 0, c: 0 };
  let shFilter = '';
  let shLastSortColCount = -1;
  function shSyncSheet() {
    const s = shSheets[shSheetIndex];
    s.grid = shGrid; s.formats = shFormats; s.colWidths = shColWidths;
  }
  function shLoadSheet(i) {
    shSyncSheet();
    shSheetIndex = i;
    const s = shSheets[shSheetIndex];
    shGrid = s.grid; shFormats = s.formats; shColWidths = s.colWidths;
    shSel = { r: 0, c: 0 };
  }
  function shBlank(rows, cols) {
    shGrid = [];
    for (let r = 0; r < rows; r += 1) shGrid.push(new Array(cols).fill(''));
    shFormats = {};
    shColWidths = [];
    shSyncSheet();
  }
  shBlank(20, 10);
  function shColName(i) {
    let s = '';
    let n = i + 1;
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  async function shRecompute() {
    try {
      const res = await api.sheets.compute(shGrid);
      if (res.ok) shComputed = res.value;
    } catch (e) { /* keep last computed values */ }
    await shRefreshDisplay();
  }
  async function shRefreshDisplay() {
    try {
      const res = await api.sheets.formatGrid(shComputed, shFormats);
      if (res.ok) shFormatted = res.value;
    } catch (e) { /* fall back to raw values */ }
    renderSheet();
  }
  function shSelectCell(r, c) {
    shSel = { r, c };
    $('sh-cellref').textContent = shColName(c) + (r + 1);
    $('sh-formula').value = shGrid[r] ? (shGrid[r][c] || '') : '';
    $('sh-format').value = shFormats[r + ',' + c] || 'general';
  }
  function renderSheetTabs() {
    const tabs = $('sh-tabs');
    tabs.innerHTML = '';
    shSheets.forEach((s, i) => {
      const b = document.createElement('button');
      b.textContent = s.name;
      b.className = i === shSheetIndex ? 'active' : '';
      b.addEventListener('click', async () => { shLoadSheet(i); await shRecompute(); });
      tabs.appendChild(b);
    });
    const add = document.createElement('button');
    add.textContent = '＋ Sheet';
    add.addEventListener('click', async () => {
      const name = await promptModal('New sheet', 'Sheet name', 'Sheet' + (shSheets.length + 1));
      if (name === null || name.trim() === '') return;
      shSyncSheet();
      const cols = shGrid.length ? shGrid[0].length : 10;
      shSheets.push({ name: name.trim(), grid: Array.from({ length: 20 }, () => new Array(cols).fill('')), formats: {}, colWidths: [] });
      shLoadSheet(shSheets.length - 1);
      await shRecompute();
    });
    tabs.appendChild(add);
    const ren = document.createElement('button');
    ren.textContent = 'Rename sheet…';
    ren.addEventListener('click', async () => {
      const name = await promptModal('Rename sheet', 'Sheet name', shSheets[shSheetIndex].name);
      if (name === null || name.trim() === '') return;
      shSheets[shSheetIndex].name = name.trim();
      renderSheetTabs();
    });
    tabs.appendChild(ren);
    const del = document.createElement('button');
    del.textContent = 'Delete sheet';
    del.addEventListener('click', async () => {
      if (shSheets.length <= 1) { toast('A workbook needs at least one sheet.', true); return; }
      const okDel = await confirmModal('Delete sheet?', 'Delete sheet "' + shSheets[shSheetIndex].name + '" and all its cells?');
      if (!okDel) return;
      shSheets.splice(shSheetIndex, 1);
      shSheetIndex = Math.min(shSheetIndex, shSheets.length - 1);
      const s = shSheets[shSheetIndex];
      shGrid = s.grid; shFormats = s.formats; shColWidths = s.colWidths;
      await shRecompute();
    });
    tabs.appendChild(del);
  }
  function renderSheet() {
    renderSheetTabs();
    const table = $('sh-grid');
    table.classList.toggle('frozen', $('sh-freeze').checked);
    table.innerHTML = '';
    const cols = shGrid.length ? shGrid[0].length : 0;
    if (cols !== shLastSortColCount) {
      shLastSortColCount = cols;
      const sel = $('sh-sort-col');
      sel.innerHTML = '';
      for (let c = 0; c < cols; c += 1) {
        const opt = document.createElement('option');
        opt.value = String(c);
        const headText = ($('sh-header-row').checked && shGrid[0] && shGrid[0][c]) ? ' (' + shGrid[0][c] + ')' : '';
        opt.textContent = shColName(c) + headText;
        sel.appendChild(opt);
      }
    }
    const head = document.createElement('tr');
    head.appendChild(document.createElement('th'));
    for (let c = 0; c < cols; c += 1) {
      const th = document.createElement('th');
      th.textContent = shColName(c);
      th.style.position = 'relative';
      const w = shColWidths[c] || 130;
      th.style.width = w + 'px';
      const grip = document.createElement('span');
      grip.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:8px;cursor:col-resize;';
      grip.title = 'Drag to resize this column';
      grip.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = shColWidths[c] || 130;
        const onMove = (ev) => {
          const nw = Math.max(40, Math.min(600, startW + ev.clientX - startX));
          shColWidths[c] = nw;
          th.style.width = nw + 'px';
          table.querySelectorAll('tr').forEach((tr) => {
            const cell = tr.children[c + 1];
            const inp = cell ? cell.querySelector('input') : null;
            if (inp) inp.style.width = nw + 'px';
          });
        };
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); shSyncSheet(); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
      th.appendChild(grip);
      head.appendChild(th);
    }
    table.appendChild(head);
    const hasHeader = $('sh-header-row').checked;
    const q = shFilter.trim().toLowerCase();
    shGrid.forEach((row, r) => {
      const tr = document.createElement('tr');
      if (q && !(hasHeader && r === 0) && !row.some((cell) => String(cell ?? '').toLowerCase().includes(q))) tr.style.display = 'none';
      const th = document.createElement('th'); th.textContent = String(r + 1); tr.appendChild(th);
      row.forEach((raw, c) => {
        const td = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'text';
        const w = shColWidths[c] || 130;
        input.style.width = w + 'px';
        const fmt = shFormatted[r] && shFormatted[r][c];
        input.value = fmt !== undefined && fmt !== null ? String(fmt) : raw;
        input.title = 'Raw: ' + raw;
        input.addEventListener('focus', () => { shSelectCell(r, c); input.value = shGrid[r][c]; });
        input.addEventListener('change', () => { shGrid[r][c] = input.value; shSyncSheet(); });
        input.addEventListener('blur', async () => { shGrid[r][c] = input.value; shSyncSheet(); await shRecompute(); });
        td.appendChild(input);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    $('sh-status').textContent = shSheets.length + ' sheet(s) · ' + shGrid.length + ' rows × ' + cols + ' columns';
  }
  $('sh-formula').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (shGrid[shSel.r]) { shGrid[shSel.r][shSel.c] = $('sh-formula').value; shSyncSheet(); await shRecompute(); }
  });
  $('sh-formula').addEventListener('change', async () => {
    if (shGrid[shSel.r]) { shGrid[shSel.r][shSel.c] = $('sh-formula').value; shSyncSheet(); await shRecompute(); }
  });
  $('sh-format').addEventListener('change', async (e) => {
    shFormats[shSel.r + ',' + shSel.c] = e.target.value;
    shSyncSheet();
    await shRefreshDisplay();
  });
  $('sh-freeze').addEventListener('change', renderSheet);
  $('sh-header-row').addEventListener('change', () => { shLastSortColCount = -1; renderSheet(); });
  $('sh-filter').addEventListener('input', (e) => { shFilter = e.target.value; renderSheet(); });
  $('sh-clear-filter').addEventListener('click', () => { shFilter = ''; $('sh-filter').value = ''; renderSheet(); });
  async function shSort(dir) {
    const col = parseInt($('sh-sort-col').value, 10);
    if (Number.isNaN(col)) return;
    try {
      const sorted = await call(api.sheets.sortRows(shGrid, col, dir, $('sh-header-row').checked), 'Sort');
      shGrid = sorted;
      shSyncSheet();
      await shRecompute();
    } catch (e) { /* already toasted */ }
  }
  $('sh-sort-asc').addEventListener('click', () => shSort('asc'));
  $('sh-sort-desc').addEventListener('click', () => shSort('desc'));
  $('sh-new').addEventListener('click', () => { shSheets = [{ name: 'Sheet1', grid: [], formats: {}, colWidths: [] }]; shSheetIndex = 0; shGrid = shSheets[0].grid; shFormats = shSheets[0].formats; shColWidths = shSheets[0].colWidths; shBlank(20, 10); shComputed = []; shFormatted = []; renderSheet(); toast('New blank workbook (1 sheet, 20 × 10).'); });
  $('sh-add-row').addEventListener('click', () => { const cols = shGrid.length ? shGrid[0].length : 10; shGrid.push(new Array(cols).fill('')); shSyncSheet(); renderSheet(); });
  $('sh-add-col').addEventListener('click', () => { shGrid.forEach((row) => row.push('')); shSyncSheet(); renderSheet(); });
  $('sh-open').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickFile([{ name: 'CSV files', extensions: ['csv'] }, { name: 'All files', extensions: ['*'] }]), 'Open CSV');
    if (!f) return;
    try {
      const out = await call(api.editor.read(f), 'Read CSV');
      const res = await call(api.sheets.csvParse(out.text), 'Parse CSV');
      shGrid = res.length ? res : [['']];
      const cols = Math.max(...shGrid.map((r) => r.length));
      shGrid = shGrid.map((r) => { while (r.length < cols) r.push(''); return r; });
      shFormats = {};
      shSyncSheet();
      await shRecompute();
      toast('CSV opened into the current sheet: ' + f);
    } catch (e) { /* already toasted */ }
  });
  $('sh-save').addEventListener('click', async () => {
    try {
      const csv = await call(api.sheets.csvStringify(shGrid), 'Build CSV');
      const target = await call(api.dialogs.pickSaveGeneric(undefined, [{ name: 'CSV files', extensions: ['csv'] }, { name: 'All files', extensions: ['*'] }]), 'Save CSV');
      if (!target) return;
      await call(api.editor.write(target, csv), 'Save CSV');
      toast('Current sheet saved as CSV: ' + target);
    } catch (e) { /* already toasted */ }
  });
  $('sh-save-book').addEventListener('click', async () => {
    shSyncSheet();
    const target = await call(api.dialogs.pickSaveGeneric(undefined, [{ name: 'OmSuite workbook', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }]), 'Save workbook');
    if (!target) return;
    try {
      await call(api.editor.write(target, JSON.stringify({ app: 'OmSuite', version: 1, sheets: shSheets }, null, 2)), 'Save workbook');
      toast('Workbook saved (' + shSheets.length + ' sheet(s)): ' + target);
    } catch (e) { /* already toasted */ }
  });
  $('sh-open-book').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickFile([{ name: 'OmSuite workbook', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }]), 'Open workbook');
    if (!f) return;
    try {
      const out = await call(api.editor.read(f), 'Read workbook');
      const book = JSON.parse(out.text);
      if (!book || !Array.isArray(book.sheets) || book.sheets.length === 0 || !book.sheets.every((s) => Array.isArray(s.grid))) {
        throw new Error('This file is not an OmSuite workbook (expected { sheets: [{ name, grid }] }).');
      }
      shSheets = book.sheets.map((s) => ({ name: String(s.name || 'Sheet'), grid: s.grid, formats: s.formats || {}, colWidths: s.colWidths || [] }));
      shSheetIndex = 0;
      const s0 = shSheets[0];
      shGrid = s0.grid; shFormats = s0.formats; shColWidths = s0.colWidths;
      await shRecompute();
      toast('Workbook opened (' + shSheets.length + ' sheet(s)): ' + f);
    } catch (e) { toast(e.message || String(e), true); }
  });
  renderSheet();

  // ---------- slides ----------
  let slSlides = [{ title: 'Title slide', body: 'Welcome to OmSuite Slides.', notes: '', imagePath: null, imageDataUrl: null }];
  let slIndex = 0;
  let slPresentIndex = 0;
  function slSaveEdit() {
    if (!slSlides[slIndex]) return;
    slSlides[slIndex].title = $('sl-title').value;
    slSlides[slIndex].body = $('sl-body').value;
    slSlides[slIndex].notes = $('sl-notes').value;
    try { localStorage.setItem('omsuite-slides-draft', JSON.stringify(slSlides)); } catch (e) { /* best-effort */ }
  }
  function renderSlides() {
    const list = $('sl-list');
    list.innerHTML = '';
    slSlides.forEach((s, i) => {
      const b = document.createElement('button');
      b.textContent = (i + 1) + '. ' + (s.title || '(untitled)');
      b.className = i === slIndex ? 'active' : '';
      b.addEventListener('click', () => { slSaveEdit(); slIndex = i; renderSlides(); });
      list.appendChild(b);
    });
    const cur = slSlides[slIndex];
    if (cur) {
      $('sl-title').value = cur.title;
      $('sl-body').value = cur.body;
      $('sl-notes').value = cur.notes || '';
      $('sl-image-name').textContent = cur.imagePath || 'No image';
      $('sl-preview').innerHTML = '<h3>' + esc(cur.title) + '</h3><p>' + esc(cur.body).replace(/\n/g, '<br>') + '</p>' +
        (cur.imageDataUrl ? '<img src="' + cur.imageDataUrl + '" alt="">' : '');
    }
  }
  $('sl-title').addEventListener('input', () => { slSaveEdit(); renderSlides(); });
  $('sl-body').addEventListener('input', () => { slSaveEdit(); renderSlides(); });
  $('sl-notes').addEventListener('input', () => { slSaveEdit(); });
  $('sl-add').addEventListener('click', () => { slSaveEdit(); slSlides.push({ title: 'New slide', body: '', notes: '', imagePath: null, imageDataUrl: null }); slIndex = slSlides.length - 1; renderSlides(); });
  $('sl-duplicate').addEventListener('click', () => {
    slSaveEdit();
    const cur = slSlides[slIndex];
    slSlides.splice(slIndex + 1, 0, { title: cur.title, body: cur.body, notes: cur.notes || '', imagePath: cur.imagePath, imageDataUrl: cur.imageDataUrl });
    slIndex += 1;
    renderSlides();
    toast('Slide duplicated.');
  });
  $('sl-delete').addEventListener('click', () => {
    if (slSlides.length <= 1) { toast('A deck needs at least one slide.', true); return; }
    slSlides.splice(slIndex, 1);
    slIndex = Math.min(slIndex, slSlides.length - 1);
    renderSlides();
  });
  $('sl-up').addEventListener('click', () => { if (slIndex > 0) { slSaveEdit(); const t = slSlides[slIndex - 1]; slSlides[slIndex - 1] = slSlides[slIndex]; slSlides[slIndex] = t; slIndex -= 1; renderSlides(); } });
  $('sl-down').addEventListener('click', () => { if (slIndex < slSlides.length - 1) { slSaveEdit(); const t = slSlides[slIndex + 1]; slSlides[slIndex + 1] = slSlides[slIndex]; slSlides[slIndex] = t; slIndex += 1; renderSlides(); } });
  $('sl-pick-image').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickFile([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }, { name: 'All files', extensions: ['*'] }]), 'Pick image');
    if (!f) return;
    try {
      const out = await call(api.binary.readBase64(f), 'Read image');
      slSaveEdit();
      slSlides[slIndex].imagePath = f;
      slSlides[slIndex].imageDataUrl = 'data:' + mimeFor(f) + ';base64,' + out.base64;
      renderSlides();
    } catch (e) { /* already toasted */ }
  });
  $('sl-clear-image').addEventListener('click', () => { slSaveEdit(); slSlides[slIndex].imagePath = null; slSlides[slIndex].imageDataUrl = null; renderSlides(); });
  function slShowPresent() {
    const s = slSlides[slPresentIndex];
    $('sl-present-slide').innerHTML = '<h2>' + esc(s.title) + '</h2><p>' + esc(s.body).replace(/\n/g, '<br>') + '</p>' +
      (s.imageDataUrl ? '<img src="' + s.imageDataUrl + '" alt="">' : '');
    $('sl-present-notes').innerHTML = s.notes ? '<strong>Speaker notes:</strong> ' + esc(s.notes).replace(/\n/g, '<br>') : '<span class="muted">No speaker notes for this slide.</span>';
    $('sl-present-pos').textContent = (slPresentIndex + 1) + ' / ' + slSlides.length;
  }
  function slExitPresent() {
    $('sl-present-overlay').classList.add('hidden');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  $('sl-present').addEventListener('click', () => {
    slSaveEdit();
    slPresentIndex = slIndex;
    $('sl-present-overlay').classList.remove('hidden');
    slShowPresent();
    $('sl-present-overlay').requestFullscreen().catch(() => { /* fullscreen is best-effort; overlay still pages */ });
  });
  $('sl-prev').addEventListener('click', () => { if (slPresentIndex > 0) { slPresentIndex -= 1; slShowPresent(); } });
  $('sl-next').addEventListener('click', () => { if (slPresentIndex < slSlides.length - 1) { slPresentIndex += 1; slShowPresent(); } });
  $('sl-exit').addEventListener('click', slExitPresent);
  document.addEventListener('keydown', (e) => {
    if ($('sl-present-overlay').classList.contains('hidden')) return;
    if (e.key === 'Escape') slExitPresent();
    else if (e.key === 'ArrowRight') $('sl-next').click();
    else if (e.key === 'ArrowLeft') $('sl-prev').click();
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !$('sl-present-overlay').classList.contains('hidden')) {
      // User left fullscreen via browser chrome: keep the overlay until Exit,
      // so paging state is not silently lost.
    }
  });
  $('sl-export').addEventListener('click', async () => {
    slSaveEdit();
    const slidesHtml = slSlides.map((s) => '<section class="slide"><h1>' + esc(s.title) + '</h1><p>' + esc(s.body).replace(/\n/g, '<br>') + '</p>' +
      (s.imageDataUrl ? '<img src="' + s.imageDataUrl + '" alt="">' : '') + '</section>').join('\n');
    const html = '<!DOCTYPE html>\n<html><head><meta charset="UTF-8"><title>OmSuite Slides export</title><style>body{font-family:system-ui,sans-serif;margin:0}.slide{min-height:100vh;padding:48px;box-sizing:border-box;border-bottom:2px solid #ccc}.slide img{max-width:80%;max-height:50vh}</style></head><body>\n' + slidesHtml + '\n</body></html>\n';
    const target = await call(api.dialogs.pickSaveGeneric(undefined, [{ name: 'HTML files', extensions: ['html'] }, { name: 'All files', extensions: ['*'] }]), 'Export slides');
    if (!target) return;
    try { await call(api.editor.write(target, html), 'Export slides'); toast('Slides exported: ' + target); } catch (e) { /* already toasted */ }
  });
  $('sl-save-deck').addEventListener('click', async () => {
    slSaveEdit();
    const target = await call(api.dialogs.pickSaveGeneric(undefined, [{ name: 'OmSuite deck', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }]), 'Save deck');
    if (!target) return;
    try { await call(api.editor.write(target, JSON.stringify({ app: 'OmSuite', version: 1, slides: slSlides }, null, 2)), 'Save deck'); toast('Deck saved: ' + target); } catch (e) { /* already toasted */ }
  });
  $('sl-open-deck').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickFile([{ name: 'OmSuite deck', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }]), 'Open deck');
    if (!f) return;
    try {
      const out = await call(api.editor.read(f), 'Read deck');
      const deck = JSON.parse(out.text);
      if (!deck || !Array.isArray(deck.slides) || deck.slides.length === 0) throw new Error('This file is not an OmSuite deck.');
      slSlides = deck.slides.map((s) => ({ title: String(s.title || ''), body: String(s.body || ''), notes: String(s.notes || ''), imagePath: s.imagePath || null, imageDataUrl: s.imageDataUrl || null }));
      slIndex = 0;
      renderSlides();
      toast('Deck opened (' + slSlides.length + ' slide(s)): ' + f);
    } catch (e) { toast(e.message || String(e), true); }
  });
  try {
    const draft = localStorage.getItem('omsuite-slides-draft');
    if (draft) {
      const parsed = JSON.parse(draft);
      if (Array.isArray(parsed) && parsed.length > 0) { slSlides = parsed.map((s) => ({ title: String(s.title || ''), body: String(s.body || ''), notes: String(s.notes || ''), imagePath: s.imagePath || null, imageDataUrl: s.imageDataUrl || null })); slIndex = 0; }
    }
  } catch (e) { /* corrupt draft: keep the default slide */ }
  renderSlides();

  // ---------- PDF studio ----------
  let pdfPath = null;
  let pdfText = '';
  let pdfMatches = [];
  let pdfMatchIndex = -1;
  let pdfZoom = 1;
  let pdfRotateDeg = 0;
  function pdfRenderText() {
    const pre = $('pdf-text');
    if (!pdfText) { pre.textContent = '(No extractable text found in this PDF. It may be image-only or use an unsupported encoding.)'; return; }
    if (pdfMatches.length === 0) { pre.textContent = pdfText; return; }
    const q = $('pdf-search').value;
    let html = '';
    let pos = 0;
    pdfMatches.forEach((m, i) => {
      html += esc(pdfText.slice(pos, m)) + '<mark' + (i === pdfMatchIndex ? ' style="background:#f59e0b;color:#000"' : '') + '>' + esc(pdfText.slice(m, m + q.length)) + '</mark>';
      pos = m + q.length;
    });
    html += esc(pdfText.slice(pos));
    pre.innerHTML = html;
    const mark = pre.querySelectorAll('mark')[pdfMatchIndex];
    if (mark) mark.scrollIntoView({ block: 'center' });
  }
  function pdfComputeSearch() {
    const q = $('pdf-search').value;
    pdfMatches = [];
    pdfMatchIndex = -1;
    if (!q || !pdfText) { $('pdf-search-count').textContent = pdfText ? 'Type to search the extracted text.' : ''; pdfRenderText(); return; }
    const hay = pdfText.toLowerCase();
    const needle = q.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1) { pdfMatches.push(i); i = hay.indexOf(needle, i + Math.max(needle.length, 1)); }
    if (pdfMatches.length) pdfMatchIndex = 0;
    $('pdf-search-count').textContent = pdfMatches.length === 0 ? 'No matches' : (pdfMatchIndex + 1) + ' of ' + pdfMatches.length;
    pdfRenderText();
  }
  function pdfApplyView() {
    const el = $('pdf-embed');
    el.style.zoom = String(pdfZoom);
    el.style.transform = 'rotate(' + pdfRotateDeg + 'deg)';
  }
  $('pdf-open').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickFile([{ name: 'PDF files', extensions: ['pdf'] }, { name: 'All files', extensions: ['*'] }]), 'Open PDF');
    if (!f) return;
    try {
      const info = await call(api.pdf.info(f), 'Read PDF');
      pdfPath = f;
      pdfText = info.text || '';
      pdfZoom = 1;
      pdfRotateDeg = 0;
      pdfMatches = [];
      pdfMatchIndex = -1;
      $('pdf-search').value = '';
      $('pdf-search-count').textContent = '';
      $('pdf-info').textContent = info.name + ' · ' + fmtSize(info.size) + ' · ' + info.pageCount + ' page(s) · ' + info.streams + ' stream(s), ' + info.inflated + ' inflated' + (info.note ? ' · Note: ' + info.note : '');
      pdfRenderText();
      const data = await call(api.binary.readBase64(f), 'Read PDF for viewer');
      $('pdf-embed').src = b64ToBlobUrl(data.base64, 'application/pdf');
      $('pdf-embed').classList.remove('hidden');
      pdfApplyView();
    } catch (e) { /* already toasted */ }
  });
  $('pdf-search').addEventListener('input', pdfComputeSearch);
  $('pdf-search-next').addEventListener('click', () => {
    if (pdfMatches.length === 0) { pdfComputeSearch(); return; }
    pdfMatchIndex = (pdfMatchIndex + 1) % pdfMatches.length;
    $('pdf-search-count').textContent = (pdfMatchIndex + 1) + ' of ' + pdfMatches.length;
    pdfRenderText();
  });
  $('pdf-search-prev').addEventListener('click', () => {
    if (pdfMatches.length === 0) { pdfComputeSearch(); return; }
    pdfMatchIndex = (pdfMatchIndex - 1 + pdfMatches.length) % pdfMatches.length;
    $('pdf-search-count').textContent = (pdfMatchIndex + 1) + ' of ' + pdfMatches.length;
    pdfRenderText();
  });
  $('pdf-zoom-in').addEventListener('click', () => { pdfZoom = Math.min(3, pdfZoom + 0.25); pdfApplyView(); });
  $('pdf-zoom-out').addEventListener('click', () => { pdfZoom = Math.max(0.5, pdfZoom - 0.25); pdfApplyView(); });
  $('pdf-zoom-reset').addEventListener('click', () => { pdfZoom = 1; pdfRotateDeg = 0; pdfApplyView(); });
  $('pdf-rotate').addEventListener('click', () => { pdfRotateDeg = (pdfRotateDeg + 90) % 360; pdfApplyView(); });
  $('pdf-open-system').addEventListener('click', async () => {
    if (!pdfPath) { toast('Open a PDF first.', true); return; }
    await call(api.files.openPath(pdfPath), 'Open in system viewer');
  });

  // ---------- media ----------
  let mdQueue = [];
  let mdQueueIndex = -1;
  let mdImgScale = 1;
  let mdImgRot = 0;
  function mdApplyImg() {
    $('md-img').style.transform = 'scale(' + mdImgScale + ') rotate(' + mdImgRot + 'deg)';
  }
  function mdRenderQueue() {
    const box = $('md-queue');
    box.innerHTML = '';
    mdQueue.forEach((item, i) => {
      const b = document.createElement('button');
      b.textContent = (i + 1) + '. ' + item.name;
      b.className = i === mdQueueIndex ? 'active' : '';
      b.addEventListener('click', () => mdShow(i));
      box.appendChild(b);
    });
  }
  function mdShow(i) {
    if (i < 0 || i >= mdQueue.length) return;
    mdQueueIndex = i;
    const item = mdQueue[i];
    $('md-img').classList.add('hidden'); $('md-audio').classList.add('hidden'); $('md-video').classList.add('hidden');
    $('md-info').textContent = item.name + ' · ' + fmtSize(item.size) + ' · item ' + (i + 1) + ' of ' + mdQueue.length;
    const speed = parseFloat($('md-speed').value) || 1;
    if (item.kind === 'image') { $('md-img').src = item.url; $('md-img').classList.remove('hidden'); mdApplyImg(); }
    else if (item.kind === 'audio') { $('md-audio').src = item.url; $('md-audio').playbackRate = speed; $('md-audio').classList.remove('hidden'); }
    else { $('md-video').src = item.url; $('md-video').playbackRate = speed; $('md-video').classList.remove('hidden'); }
    mdRenderQueue();
  }
  function mdCurrentMediaEl() {
    if (mdQueueIndex < 0) return null;
    const kind = mdQueue[mdQueueIndex].kind;
    return kind === 'audio' ? $('md-audio') : kind === 'video' ? $('md-video') : null;
  }
  async function mdOpen(kind) {
    const filters = kind === 'image'
      ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
      : kind === 'audio'
        ? [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] }]
        : [{ name: 'Video', extensions: ['mp4', 'webm', 'mkv', 'mov'] }];
    const f = await call(api.dialogs.pickFile([...filters, { name: 'All files', extensions: ['*'] }]), 'Open media');
    if (!f) return;
    try {
      const out = await call(api.binary.readBase64(f), 'Read media');
      const url = b64ToBlobUrl(out.base64, mimeFor(f));
      const existing = mdQueue.findIndex((q) => q.path === f);
      if (existing >= 0) { mdShow(existing); return; }
      mdQueue.push({ path: f, kind, url, name: out.name, size: out.size });
      mdShow(mdQueue.length - 1);
    } catch (e) { /* already toasted */ }
  }
  $('md-open-image').addEventListener('click', () => mdOpen('image'));
  $('md-open-audio').addEventListener('click', () => mdOpen('audio'));
  $('md-open-video').addEventListener('click', () => mdOpen('video'));
  $('md-zoom-in').addEventListener('click', () => { mdImgScale = Math.min(4, mdImgScale + 0.25); mdApplyImg(); });
  $('md-zoom-out').addEventListener('click', () => { mdImgScale = Math.max(0.25, mdImgScale - 0.25); mdApplyImg(); });
  $('md-rotate').addEventListener('click', () => { mdImgRot = (mdImgRot + 90) % 360; mdApplyImg(); });
  $('md-speed').addEventListener('change', (e) => {
    const el = mdCurrentMediaEl();
    if (el) el.playbackRate = parseFloat(e.target.value) || 1;
  });
  $('md-back10').addEventListener('click', () => { const el = mdCurrentMediaEl(); if (el) el.currentTime = Math.max(0, el.currentTime - 10); });
  $('md-fwd10').addEventListener('click', () => { const el = mdCurrentMediaEl(); if (el) el.currentTime = Math.min(el.duration || el.currentTime, el.currentTime + 10); });
  $('md-prev').addEventListener('click', () => { if (mdQueueIndex > 0) mdShow(mdQueueIndex - 1); });
  $('md-next').addEventListener('click', () => { if (mdQueueIndex < mdQueue.length - 1) mdShow(mdQueueIndex + 1); });

  // ---------- e-books ----------
  let ebChapters = [];
  let ebIndex = 0;
  let ebPath = null;
  let ebToc = [];
  let ebFontSize = 14;
  function ebStateKey() { return 'omsuite-ebook-state'; }
  function ebReadState() {
    try { return JSON.parse(localStorage.getItem(ebStateKey()) || '{}'); } catch (e) { return {}; }
  }
  function ebWriteState(state) {
    try { localStorage.setItem(ebStateKey(), JSON.stringify(state)); } catch (e) { /* best-effort */ }
  }
  function ebSaveProgress() {
    if (!ebPath) return;
    const state = ebReadState();
    const cur = state[ebPath] || {};
    cur.chapter = ebIndex;
    cur.bookmarks = cur.bookmarks || [];
    state[ebPath] = cur;
    ebWriteState(state);
  }
  function ebBookmarks() {
    if (!ebPath) return [];
    const state = ebReadState();
    return (state[ebPath] && state[ebPath].bookmarks) || [];
  }
  function ebApplyTextStyle() {
    const el = $('eb-text');
    el.style.fontSize = ebFontSize + 'px';
    el.classList.remove('sepia', 'theme-dark');
    const theme = $('eb-theme').value;
    if (theme === 'sepia') el.classList.add('sepia');
    else if (theme === 'dark') el.classList.add('theme-dark');
  }
  function ebShow() {
    const tocBox = $('eb-toc');
    tocBox.innerHTML = '';
    ebToc.forEach((t) => {
      const b = document.createElement('button');
      b.textContent = '▸ ' + (t.title || t.path);
      b.title = t.path || '';
      b.addEventListener('click', () => {
        const idx = ebChapters.findIndex((ch) => ch.path === t.path);
        ebIndex = idx >= 0 ? idx : 0;
        ebShow();
      });
      tocBox.appendChild(b);
    });
    const bmBox = $('eb-bookmarks');
    bmBox.innerHTML = '';
    ebBookmarks().forEach((bm) => {
      const row = document.createElement('span');
      row.style.display = 'inline-flex';
      row.style.gap = '4px';
      const b = document.createElement('button');
      b.textContent = '🔖 ' + bm.title;
      b.addEventListener('click', () => { ebIndex = Math.min(bm.chapter, ebChapters.length - 1); ebShow(); });
      const rm = document.createElement('button');
      rm.textContent = '✕';
      rm.title = 'Remove bookmark';
      rm.addEventListener('click', () => {
        const state = ebReadState();
        if (state[ebPath]) state[ebPath].bookmarks = (state[ebPath].bookmarks || []).filter((x) => x.chapter !== bm.chapter);
        ebWriteState(state);
        ebShow();
      });
      row.appendChild(b);
      row.appendChild(rm);
      bmBox.appendChild(row);
    });
    const list = $('eb-chapters');
    list.innerHTML = '';
    ebChapters.forEach((ch, i) => {
      const b = document.createElement('button');
      b.textContent = (i + 1) + '. ' + (ch.title || ch.path || ('Chapter ' + (i + 1)));
      b.className = i === ebIndex ? 'active' : '';
      b.addEventListener('click', () => { ebIndex = i; ebShow(); });
      list.appendChild(b);
    });
    const cur = ebChapters[ebIndex];
    $('eb-text').textContent = cur ? (cur.error ? 'Chapter could not be read: ' + cur.error : (cur.text || '(This chapter has no extractable text.)')) : '';
    ebApplyTextStyle();
    if (ebChapters.length) $('eb-meta').textContent = $('eb-meta').textContent.replace(/ · reading chapter.*$/, '') + ' · reading chapter ' + (ebIndex + 1) + ' of ' + ebChapters.length;
    ebSaveProgress();
  }
  $('eb-open-epub').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickFile([{ name: 'EPUB files', extensions: ['epub'] }, { name: 'All files', extensions: ['*'] }]), 'Open EPUB');
    if (!f) return;
    try {
      const book = await call(api.epub.read(f), 'Read EPUB');
      ebPath = f;
      ebChapters = book.chapters.map((ch) => ({ title: ch.title || ch.path, path: ch.path, text: ch.text, error: ch.error }));
      ebToc = book.toc || [];
      const saved = ebReadState()[f];
      ebIndex = saved && Number.isInteger(saved.chapter) ? Math.min(saved.chapter, ebChapters.length - 1) : 0;
      $('eb-meta').textContent = (book.title || 'Untitled') + (book.creator ? ' · by ' + book.creator : '') + ' · ' + ebChapters.length + ' chapter(s)'
        + (book.encrypted ? ' · WARNING: this EPUB lists DRM/encryption — text may be unreadable and is never decrypted here' : '')
        + (saved ? ' · resumed at your saved chapter' : '');
      ebShow();
    } catch (e) { /* already toasted */ }
  });
  $('eb-open-txt').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickTextFile(), 'Open TXT');
    if (!f) return;
    try {
      const out = await call(api.editor.read(f), 'Read text');
      ebPath = f;
      ebChapters = [{ title: f, path: f, text: out.text, error: null }];
      ebToc = [{ title: f, src: f, path: f }];
      const saved = ebReadState()[f];
      ebIndex = 0;
      $('eb-meta').textContent = 'Plain text: ' + f;
      ebShow();
    } catch (e) { /* already toasted */ }
  });
  $('eb-prev').addEventListener('click', () => { if (ebIndex > 0) { ebIndex -= 1; ebShow(); } });
  $('eb-next').addEventListener('click', () => { if (ebIndex < ebChapters.length - 1) { ebIndex += 1; ebShow(); } });
  $('eb-search-go').addEventListener('click', () => {
    const q = $('eb-search').value.trim().toLowerCase();
    if (!q || ebChapters.length === 0) { $('eb-search-result').textContent = ''; return; }
    const hits = [];
    ebChapters.forEach((ch, i) => { if ((ch.text || '').toLowerCase().includes(q)) hits.push(i); });
    if (hits.length === 0) { $('eb-search-result').textContent = 'No chapter contains "' + $('eb-search').value.trim() + '".'; return; }
    const after = hits.find((i) => i >= ebIndex) ?? hits[0];
    // Prefer a later chapter than the current one when searching again.
    const next = hits.find((i) => i > ebIndex);
    ebIndex = next !== undefined ? next : after;
    $('eb-search-result').textContent = 'Found in ' + hits.length + ' chapter(s); showing chapter ' + (ebIndex + 1) + '.';
    ebShow();
  });
  $('eb-font-smaller').addEventListener('click', () => { ebFontSize = Math.max(10, ebFontSize - 2); ebApplyTextStyle(); });
  $('eb-font-bigger').addEventListener('click', () => { ebFontSize = Math.min(28, ebFontSize + 2); ebApplyTextStyle(); });
  $('eb-theme').addEventListener('change', ebApplyTextStyle);
  $('eb-bookmark').addEventListener('click', () => {
    if (!ebPath || !ebChapters[ebIndex]) { toast('Open a book first.', true); return; }
    const state = ebReadState();
    const cur = state[ebPath] || {};
    cur.bookmarks = cur.bookmarks || [];
    if (!cur.bookmarks.some((b) => b.chapter === ebIndex)) {
      cur.bookmarks.push({ chapter: ebIndex, title: ebChapters[ebIndex].title || ('Chapter ' + (ebIndex + 1)) });
      state[ebPath] = cur;
      ebWriteState(state);
      toast('Bookmarked chapter ' + (ebIndex + 1) + '.');
    } else {
      toast('This chapter is already bookmarked.');
    }
    ebShow();
  });

  // ---------- archives ----------
  let arFiles = [];
  let arZipPath = null;
  let arEntries = [];
  let arSelected = new Set();
  function arRenderEntries() {
    const box = $('ar-entries');
    box.innerHTML = '';
    if (!arEntries.length) { box.innerHTML = '<p class="muted">This ZIP has no entries.</p>'; return; }
    arEntries.forEach((e) => {
      const row = document.createElement('div');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = arSelected.has(e.name);
      cb.disabled = e.name.endsWith('/') || e.encrypted;
      cb.addEventListener('change', () => {
        if (cb.checked) arSelected.add(e.name); else arSelected.delete(e.name);
      });
      const label = document.createElement('span');
      label.textContent = ' ' + e.name + ' · ' + fmtSize(e.size) + ' (compressed ' + fmtSize(e.compressedSize) + ')' + (e.encrypted ? ' · ENCRYPTED — cannot be extracted' : '') + (e.name.endsWith('/') ? ' · folder' : '');
      row.appendChild(cb);
      row.appendChild(label);
      box.appendChild(row);
    });
  }
  $('ar-pick').addEventListener('click', async () => {
    const files = await call(api.dialogs.pickFiles(), 'Pick files');
    if (files && files.length) { arFiles = files; $('ar-info').textContent = arFiles.length + ' file(s) selected for a new ZIP: ' + arFiles.join(', '); }
  });
  $('ar-create').addEventListener('click', async () => {
    if (!arFiles.length) { toast('Pick files first.', true); return; }
    const target = await call(api.dialogs.pickSaveGeneric(undefined, [{ name: 'ZIP files', extensions: ['zip'] }, { name: 'All files', extensions: ['*'] }]), 'Create ZIP');
    if (!target) return;
    try {
      const out = await call(api.archives.create(arFiles, target), 'Create ZIP');
      arZipPath = out.path;
      $('ar-info').textContent = 'Created ' + out.path + ' (' + out.entries + ' entries, ' + fmtSize(out.size) + ').';
      toast('ZIP created.');
    } catch (e) { /* already toasted */ }
  });
  $('ar-open-zip').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickFile([{ name: 'ZIP files', extensions: ['zip'] }, { name: 'All files', extensions: ['*'] }]), 'Open ZIP');
    if (!f) return;
    try {
      const entries = await call(api.archives.list(f), 'List ZIP');
      arZipPath = f;
      arEntries = entries;
      arSelected = new Set(entries.filter((e) => !e.name.endsWith('/') && !e.encrypted).map((e) => e.name));
      arRenderEntries();
      $('ar-info').textContent = f + ' · ' + entries.length + ' entr(ies). Tick entries, then Extract selected — or Extract all. Existing files are never overwritten: clashes get a numbered name.';
    } catch (e) { /* already toasted */ }
  });
  $('ar-extract').addEventListener('click', async () => {
    if (!arZipPath) { toast('Open a ZIP first.', true); return; }
    const dir = await call(api.dialogs.pickFolder(), 'Extract to folder');
    if (!dir) return;
    try {
      const out = await call(api.archives.extract(arZipPath, dir), 'Extract ZIP');
      let msg = 'Extracted ' + out.entries + ' file(s) to ' + out.destDir;
      if (out.renamed) msg += ' (' + out.renamed + ' renamed to avoid overwriting)';
      if (out.skippedEncrypted && out.skippedEncrypted.length) msg += ' — skipped ' + out.skippedEncrypted.length + ' encrypted entr(ies) (no password support)';
      toast(msg);
    } catch (e) { /* already toasted */ }
  });
  $('ar-extract-selected').addEventListener('click', async () => {
    if (!arZipPath) { toast('Open a ZIP first.', true); return; }
    const names = [...arSelected];
    if (!names.length) { toast('Tick at least one entry first.', true); return; }
    const dir = await call(api.dialogs.pickFolder(), 'Extract selected to folder');
    if (!dir) return;
    try {
      const out = await call(api.archives.extractSelected(arZipPath, dir, names), 'Extract selected');
      let msg = 'Extracted ' + out.entries + ' selected file(s) to ' + out.destDir;
      if (out.renamed) msg += ' (' + out.renamed + ' renamed to avoid overwriting)';
      toast(msg);
    } catch (e) { /* already toasted */ }
  });

  // ---------- converter ----------
  const CV_PAIRS = { CSV: ['JSON'], JSON: ['CSV', 'JSON (pretty)'], TXT: ['Markdown'] };
  function cvSyncPairs() {
    const from = $('cv-from').value;
    const toSel = $('cv-to');
    const prev = toSel.value;
    toSel.innerHTML = '';
    (CV_PAIRS[from] || []).forEach((t) => {
      const opt = document.createElement('option');
      opt.textContent = t;
      toSel.appendChild(opt);
    });
    if ((CV_PAIRS[from] || []).includes(prev)) toSel.value = prev;
  }
  function cvReadHistory() {
    try { return JSON.parse(localStorage.getItem('omsuite-convert-history') || '[]'); } catch (e) { return []; }
  }
  function cvRenderHistory() {
    const box = $('cv-history');
    const hist = cvReadHistory();
    if (!hist.length) { box.innerHTML = '<p class="muted">No conversions yet.</p>'; return; }
    box.innerHTML = '';
    hist.forEach((h) => {
      const b = document.createElement('button');
      b.textContent = new Date(h.at).toLocaleString() + ' · ' + h.from + ' → ' + h.to + ' · ' + (h.inputPreview || '');
      b.title = 'Restore this conversion';
      b.addEventListener('click', () => {
        $('cv-from').value = h.from;
        cvSyncPairs();
        $('cv-to').value = h.to;
        $('cv-in').value = h.input || '';
        $('cv-out').value = h.output || '';
      });
      box.appendChild(b);
    });
  }
  $('cv-from').addEventListener('change', cvSyncPairs);
  cvSyncPairs();
  cvRenderHistory();
  $('cv-run').addEventListener('click', async () => {
    const from = $('cv-from').value;
    const to = $('cv-to').value;
    const res = await api.convert.run(from, to, $('cv-in').value);
    if (!res.ok) {
      $('cv-out').value = 'Not supported: ' + from + ' → ' + to + (res.error && !res.error.startsWith('Not supported') ? ' (' + res.error + ')' : '');
      toast('Not supported: ' + from + ' → ' + to, true);
      return;
    }
    $('cv-out').value = res.value;
    try {
      const hist = cvReadHistory();
      hist.unshift({ from, to, at: Date.now(), input: $('cv-in').value.slice(0, 2000), output: res.value.slice(0, 2000), inputPreview: $('cv-in').value.slice(0, 60).replace(/\s+/g, ' ') });
      localStorage.setItem('omsuite-convert-history', JSON.stringify(hist.slice(0, 20)));
    } catch (e) { /* history is best-effort */ }
    cvRenderHistory();
  });
  $('cv-clear-history').addEventListener('click', () => {
    try { localStorage.removeItem('omsuite-convert-history'); } catch (e) { /* ignore */ }
    $('cv-in').value = '';
    $('cv-out').value = '';
    cvRenderHistory();
    toast('Conversion history cleared.');
  });
  $('cv-save').addEventListener('click', async () => {
    if (!$('cv-out').value) { toast('Nothing to save — convert something first.', true); return; }
    const target = await call(api.dialogs.pickSaveGeneric(undefined, [{ name: 'All files', extensions: ['*'] }]), 'Save output');
    if (!target) return;
    try { await call(api.editor.write(target, $('cv-out').value), 'Save output'); toast('Saved: ' + target); } catch (e) { /* already toasted */ }
  });

  // ---------- scan & OCR ----------
  let scScale = 1;
  let scRot = 0;
  function scApply() {
    $('sc-img').style.transform = 'scale(' + scScale + ') rotate(' + scRot + 'deg)';
  }
  $('sc-zoom-in').addEventListener('click', () => { scScale = Math.min(4, scScale + 0.25); scApply(); });
  $('sc-zoom-out').addEventListener('click', () => { scScale = Math.max(0.25, scScale - 0.25); scApply(); });
  $('sc-rotate').addEventListener('click', () => { scRot = (scRot + 90) % 360; scApply(); });
  $('sc-pick').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickFile([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff'] }, { name: 'All files', extensions: ['*'] }]), 'Pick image');
    if (!f) return;
    try {
      const out = await call(api.binary.readBase64(f), 'Read image');
      $('sc-img').src = b64ToBlobUrl(out.base64, mimeFor(f));
      $('sc-img').classList.remove('hidden');
      $('sc-info').textContent = out.name + ' · ' + fmtSize(out.size) + ' · OCR is disabled (no OCR engine bundled).';
    } catch (e) { /* already toasted */ }
  });

  // ---------- code editor with highlighting ----------
  let cdPath = null;
  let cdHighlightOn = false; // plain editing by default; toggle shows highlighted preview
  let cdMeta = { hasBom: false, lineEnding: 'lf' };
  let cdFindMatches = [];
  let cdFindIndex = -1;
  function cdDetectMeta(text) {
    const hasBom = text.charCodeAt(0) === 0xfeff;
    const body = hasBom ? text.slice(1) : text;
    const crlf = (body.match(/\r\n/g) || []).length;
    const lfOnly = (body.replace(/\r\n/g, '').match(/\n/g) || []).length;
    let lineEnding = 'lf';
    if (crlf > 0 && lfOnly === 0) lineEnding = 'crlf';
    else if (crlf > 0 && lfOnly > 0) lineEnding = 'mixed';
    return { hasBom, lineEnding };
  }
  function cdApplyMeta(text) {
    let t = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (cdMeta.lineEnding === 'crlf') t = t.replace(/\n/g, '\r\n');
    if (cdMeta.hasBom) t = '\uFEFF' + t.replace(/^\uFEFF/, '');
    return t;
  }
  function cdUpdateLines() {
    const ta = $('cd-text');
    const count = ta.value === '' ? 1 : ta.value.split('\n').length;
    const nums = [];
    for (let i = 1; i <= count; i += 1) nums.push(String(i));
    $('cd-lines').textContent = nums.join('\n');
    $('cd-lines').scrollTop = ta.scrollTop;
  }
  function cdMetaLabel() {
    $('cd-meta').textContent = 'Line endings: ' + (cdMeta.lineEnding === 'crlf' ? 'CRLF (Windows)' : cdMeta.lineEnding === 'mixed' ? 'mixed — saves as LF, because a plain textarea cannot keep per-line endings' : 'LF') + ' · BOM: ' + (cdMeta.hasBom ? 'yes' : 'no') + ' — CRLF and BOM are preserved on save, so opening and saving a file does not rewrite its line endings. Line numbers count the file\'s lines; highlighting is a preview toggle — editing always happens in plain text.';
  }
  async function cdRender() {
    const text = $('cd-text').value;
    if (!cdHighlightOn) { $('cd-preview').classList.add('hidden'); $('cd-text').classList.remove('hidden'); $('cd-lines').classList.remove('hidden'); return; }
    try {
      const res = await api.highlight.render(text, $('cd-lang').value);
      if (res.ok) {
        $('cd-preview').innerHTML = res.value;
        $('cd-preview').classList.remove('hidden');
        $('cd-text').classList.add('hidden');
        $('cd-lines').classList.add('hidden');
      }
    } catch (e) { /* preview failure leaves plain text visible */ }
  }
  function cdComputeFind() {
    const q = $('cd-find').value;
    const text = $('cd-text').value;
    cdFindMatches = [];
    cdFindIndex = -1;
    if (!q) { $('cd-find-count').textContent = ''; return; }
    const hay = text.toLowerCase();
    const needle = q.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1) { cdFindMatches.push(i); i = hay.indexOf(needle, i + Math.max(needle.length, 1)); }
    if (cdFindMatches.length) { cdFindIndex = 0; cdGotoMatch(0); }
    else $('cd-find-count').textContent = 'No matches';
  }
  function cdGotoMatch(idx) {
    if (cdFindMatches.length === 0) return;
    cdFindIndex = ((idx % cdFindMatches.length) + cdFindMatches.length) % cdFindMatches.length;
    const pos = cdFindMatches[cdFindIndex];
    const ta = $('cd-text');
    ta.focus();
    ta.setSelectionRange(pos, pos + $('cd-find').value.length);
    $('cd-find-count').textContent = (cdFindIndex + 1) + ' of ' + cdFindMatches.length;
  }
  function cdIndentLines(add) {
    const ta = $('cd-text');
    const indent = $('cd-lang').value === 'python' ? '    ' : '  ';
    const s = ta.selectionStart, e = ta.selectionEnd;
    const startLine = ta.value.lastIndexOf('\n', s - 1) + 1;
    const endLine = e === s ? s : ta.value.indexOf('\n', e);
    const end = endLine === -1 ? ta.value.length : endLine;
    const block = ta.value.slice(startLine, end);
    const out = block.split('\n').map((ln) => {
      if (add) return indent + ln;
      return ln.startsWith(indent) ? ln.slice(indent.length) : ln.replace(/^ +/, (m) => m.slice(0, Math.max(0, m.length - indent.length)));
    }).join('\n');
    ta.setRangeText(out, startLine, end, 'end');
    ta.setSelectionRange(startLine, startLine + out.length);
    cdUpdateLines();
  }
  let cdTimer = null;
  $('cd-text').addEventListener('input', () => { cdUpdateLines(); if (cdTimer) clearTimeout(cdTimer); cdTimer = setTimeout(cdRender, 300); });
  $('cd-text').addEventListener('scroll', () => { $('cd-lines').scrollTop = $('cd-text').scrollTop; });
  $('cd-lang').addEventListener('change', cdRender);
  $('cd-toggle').addEventListener('click', async () => {
    cdHighlightOn = !cdHighlightOn;
    $('cd-toggle').textContent = cdHighlightOn ? '🎨 Highlight: ON' : '📄 Highlight: OFF';
    if (!cdHighlightOn) { $('cd-preview').classList.add('hidden'); $('cd-text').classList.remove('hidden'); }
    else await cdRender();
  });
  $('cd-open').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickFile([
      { name: 'Code', extensions: ['js', 'ts', 'py', 'kt', 'kts', 'java', 'c', 'cpp', 'h', 'cs', 'html', 'css', 'json'] },
      { name: 'All files', extensions: ['*'] },
    ]), 'Open code file');
    if (!f) return;
    try {
      const out = await call(api.editor.read(f), 'Read code file');
      cdPath = f;
      cdMeta = cdDetectMeta(out.text);
      $('cd-text').value = cdMeta.hasBom ? out.text.slice(1) : out.text;
      $('cd-path').textContent = f;
      cdMetaLabel();
      cdUpdateLines();
      const ext = f.split('.').pop().toLowerCase();
      if (ext === 'py') $('cd-lang').value = 'python';
      else if (ext === 'kt' || ext === 'kts') $('cd-lang').value = 'kotlin';
      else $('cd-lang').value = 'javascript';
      await cdRender();
    } catch (e) { /* already toasted */ }
  });
  $('cd-save').addEventListener('click', async () => {
    if (!cdPath) { toast('Open a code file first, then save — or use Save as…', true); return; }
    try { await call(api.editor.write(cdPath, cdApplyMeta($('cd-text').value)), 'Save code'); toast('Saved (line endings + BOM preserved).'); } catch (e) { /* already toasted */ }
  });
  $('cd-save-as').addEventListener('click', async () => {
    const target = await call(api.dialogs.pickSaveGeneric(cdPath || undefined, [{ name: 'All files', extensions: ['*'] }]), 'Save code as');
    if (!target) return;
    try {
      await call(api.editor.write(target, cdApplyMeta($('cd-text').value)), 'Save code as');
      cdPath = target;
      $('cd-path').textContent = target;
      toast('Saved as ' + target);
    } catch (e) { /* already toasted */ }
  });
  $('cd-indent').addEventListener('click', () => cdIndentLines(true));
  $('cd-outdent').addEventListener('click', () => cdIndentLines(false));
  $('cd-find').addEventListener('input', cdComputeFind);
  $('cd-find-next').addEventListener('click', () => cdGotoMatch(cdFindIndex + 1));
  $('cd-find-prev').addEventListener('click', () => cdGotoMatch(cdFindIndex - 1));
  $('cd-replace-all').addEventListener('click', () => {
    const q = $('cd-find').value;
    if (!q) return;
    const ta = $('cd-text');
    const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const count = (ta.value.match(pattern) || []).length;
    ta.value = ta.value.replace(pattern, $('cd-replace').value);
    cdUpdateLines();
    cdComputeFind();
    toast('Replaced ' + count + ' occurrence(s).');
  });
  cdUpdateLines();
  cdRender();

  // ---------- init ----------
  (async function init() {
    try {
      settings = await call(api.settings.get(), 'Load settings');
      if (settings && settings.sidebarWidth) $('sidebar').style.width = settings.sidebarWidth + 'px';
      applyTheme();
      renderSettings();
      renderFavs();
      const home = await call(api.files.homeDir(), 'Home folder');
      await navigate(home, false);
      await renderHome();
      updateEditorChrome();
      // Untitled draft recovery: a draft with no file path is restored
      // into a fresh editor so unsaved typing is not silently lost.
      const draft = edReadDraft();
      if (draft && !draft.path && draft.text) {
        edPath = null; edSavedText = ''; edLastCommitted = draft.text;
        edTextEl().value = draft.text;
        updateEditorChrome();
        toast('Unsaved draft recovered from the last session.');
      }
      console.log('OMSUITE_RENDERER_READY');
    } catch (err) {
      toast('Startup failed: ' + err.message, true);
    }
  })();
})();

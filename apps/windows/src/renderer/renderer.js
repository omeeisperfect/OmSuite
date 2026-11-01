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
      const b = document.createElement('button');
      b.textContent = '📁 ' + f;
      b.title = f;
      b.addEventListener('click', () => { switchView('files'); navigate(f); });
      list.appendChild(b);
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
    for (const p of clipboard.paths) {
      try {
        if (clipboard.mode === 'copy') await call(api.files.copy(p, currentDir), 'Copy');
        else await call(api.files.move(p, currentDir), 'Move');
        done += 1;
      } catch (e) { break; }
    }
    if (clipboard.mode === 'cut') clipboard = null;
    toast('Pasted ' + done + ' item(s).');
    navigate(currentDir, false);
  }
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
    for (const f of files) { try { await call(api.files.copy(f, currentDir), 'Copy here'); done += 1; } catch (e) { break; } }
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
    for (const f of files) { try { await call(api.files.copy(f, currentDir), 'Copy here'); done += 1; } catch (err) { break; } }
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
      console.log('OMSUITE_RENDERER_READY');
    } catch (err) {
      toast('Startup failed: ' + err.message, true);
    }
  })();
})();

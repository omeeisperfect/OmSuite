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
  let shGrid = [];
  let shComputed = [];
  function shBlank(rows, cols) {
    shGrid = [];
    for (let r = 0; r < rows; r += 1) shGrid.push(new Array(cols).fill(''));
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
    renderSheet();
  }
  function renderSheet() {
    const table = $('sh-grid');
    table.innerHTML = '';
    const cols = shGrid.length ? shGrid[0].length : 0;
    const head = document.createElement('tr');
    head.appendChild(document.createElement('th'));
    for (let c = 0; c < cols; c += 1) { const th = document.createElement('th'); th.textContent = shColName(c); head.appendChild(th); }
    table.appendChild(head);
    shGrid.forEach((row, r) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th'); th.textContent = String(r + 1); tr.appendChild(th);
      row.forEach((raw, c) => {
        const td = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'text';
        const comp = shComputed[r] && shComputed[r][c];
        input.value = comp !== undefined && comp !== null ? String(comp) : raw;
        input.title = 'Raw: ' + raw;
        input.addEventListener('focus', () => { input.value = shGrid[r][c]; });
        input.addEventListener('change', () => { shGrid[r][c] = input.value; });
        input.addEventListener('blur', async () => { shGrid[r][c] = input.value; await shRecompute(); });
        td.appendChild(input);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    $('sh-status').textContent = shGrid.length + ' rows × ' + cols + ' columns';
  }
  $('sh-new').addEventListener('click', () => { shBlank(20, 10); shComputed = []; renderSheet(); toast('New blank sheet (20 × 10).'); });
  $('sh-add-row').addEventListener('click', () => { const cols = shGrid.length ? shGrid[0].length : 10; shGrid.push(new Array(cols).fill('')); renderSheet(); });
  $('sh-add-col').addEventListener('click', () => { shGrid.forEach((row) => row.push('')); renderSheet(); });
  $('sh-open').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickFile([{ name: 'CSV files', extensions: ['csv'] }, { name: 'All files', extensions: ['*'] }]), 'Open CSV');
    if (!f) return;
    try {
      const out = await call(api.editor.read(f), 'Read CSV');
      const res = await call(api.sheets.csvParse(out.text), 'Parse CSV');
      shGrid = res.length ? res : [['']];
      const cols = Math.max(...shGrid.map((r) => r.length));
      shGrid = shGrid.map((r) => { while (r.length < cols) r.push(''); return r; });
      await shRecompute();
      toast('CSV opened: ' + f);
    } catch (e) { /* already toasted */ }
  });
  $('sh-save').addEventListener('click', async () => {
    try {
      const csv = await call(api.sheets.csvStringify(shGrid), 'Build CSV');
      const target = await call(api.dialogs.pickSaveGeneric(undefined, [{ name: 'CSV files', extensions: ['csv'] }, { name: 'All files', extensions: ['*'] }]), 'Save CSV');
      if (!target) return;
      await call(api.editor.write(target, csv), 'Save CSV');
      toast('CSV saved: ' + target);
    } catch (e) { /* already toasted */ }
  });
  renderSheet();

  // ---------- slides ----------
  let slSlides = [{ title: 'Title slide', body: 'Welcome to OmSuite Slides.', imagePath: null, imageDataUrl: null }];
  let slIndex = 0;
  let slPresentIndex = 0;
  function slSaveEdit() {
    if (!slSlides[slIndex]) return;
    slSlides[slIndex].title = $('sl-title').value;
    slSlides[slIndex].body = $('sl-body').value;
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
      $('sl-image-name').textContent = cur.imagePath || 'No image';
      $('sl-preview').innerHTML = '<h3>' + esc(cur.title) + '</h3><p>' + esc(cur.body).replace(/\n/g, '<br>') + '</p>' +
        (cur.imageDataUrl ? '<img src="' + cur.imageDataUrl + '" alt="">' : '');
    }
  }
  $('sl-title').addEventListener('input', () => { slSaveEdit(); renderSlides(); });
  $('sl-body').addEventListener('input', () => { slSaveEdit(); renderSlides(); });
  $('sl-add').addEventListener('click', () => { slSaveEdit(); slSlides.push({ title: 'New slide', body: '', imagePath: null, imageDataUrl: null }); slIndex = slSlides.length - 1; renderSlides(); });
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
  renderSlides();

  // ---------- PDF studio ----------
  let pdfPath = null;
  $('pdf-open').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickFile([{ name: 'PDF files', extensions: ['pdf'] }, { name: 'All files', extensions: ['*'] }]), 'Open PDF');
    if (!f) return;
    try {
      const info = await call(api.pdf.info(f), 'Read PDF');
      pdfPath = f;
      $('pdf-info').textContent = info.name + ' · ' + fmtSize(info.size) + ' · ' + info.pageCount + ' page(s) · ' + info.streams + ' stream(s), ' + info.inflated + ' inflated' + (info.note ? ' · Note: ' + info.note : '');
      $('pdf-text').textContent = info.text || '(No extractable text found in this PDF. It may be image-only or use an unsupported encoding.)';
      const data = await call(api.binary.readBase64(f), 'Read PDF for viewer');
      $('pdf-embed').src = b64ToBlobUrl(data.base64, 'application/pdf');
      $('pdf-embed').classList.remove('hidden');
    } catch (e) { /* already toasted */ }
  });
  $('pdf-open-system').addEventListener('click', async () => {
    if (!pdfPath) { toast('Open a PDF first.', true); return; }
    await call(api.files.openPath(pdfPath), 'Open in system viewer');
  });

  // ---------- media ----------
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
      $('md-img').classList.add('hidden'); $('md-audio').classList.add('hidden'); $('md-video').classList.add('hidden');
      $('md-info').textContent = out.name + ' · ' + fmtSize(out.size);
      if (kind === 'image') { $('md-img').src = url; $('md-img').classList.remove('hidden'); }
      else if (kind === 'audio') { $('md-audio').src = url; $('md-audio').classList.remove('hidden'); }
      else { $('md-video').src = url; $('md-video').classList.remove('hidden'); }
    } catch (e) { /* already toasted */ }
  }
  $('md-open-image').addEventListener('click', () => mdOpen('image'));
  $('md-open-audio').addEventListener('click', () => mdOpen('audio'));
  $('md-open-video').addEventListener('click', () => mdOpen('video'));

  // ---------- e-books ----------
  let ebChapters = [];
  let ebIndex = 0;
  function ebShow() {
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
  }
  $('eb-open-epub').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickFile([{ name: 'EPUB files', extensions: ['epub'] }, { name: 'All files', extensions: ['*'] }]), 'Open EPUB');
    if (!f) return;
    try {
      const book = await call(api.epub.read(f), 'Read EPUB');
      ebChapters = book.chapters.map((ch) => ({ title: ch.path, path: ch.path, text: ch.text, error: ch.error }));
      ebIndex = 0;
      $('eb-meta').textContent = (book.title || 'Untitled') + (book.creator ? ' · by ' + book.creator : '') + ' · ' + ebChapters.length + ' chapter(s)';
      ebShow();
    } catch (e) { /* already toasted */ }
  });
  $('eb-open-txt').addEventListener('click', async () => {
    const f = await call(api.dialogs.pickTextFile(), 'Open TXT');
    if (!f) return;
    try {
      const out = await call(api.editor.read(f), 'Read text');
      ebChapters = [{ title: f, path: f, text: out.text, error: null }];
      ebIndex = 0;
      $('eb-meta').textContent = 'Plain text: ' + f;
      ebShow();
    } catch (e) { /* already toasted */ }
  });
  $('eb-prev').addEventListener('click', () => { if (ebIndex > 0) { ebIndex -= 1; ebShow(); } });
  $('eb-next').addEventListener('click', () => { if (ebIndex < ebChapters.length - 1) { ebIndex += 1; ebShow(); } });

  // ---------- archives ----------
  let arFiles = [];
  let arZipPath = null;
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
      const box = $('ar-entries');
      box.innerHTML = '';
      if (!entries.length) box.innerHTML = '<p class="muted">This ZIP has no entries.</p>';
      entries.forEach((e) => {
        const d = document.createElement('div');
        d.textContent = e.name + ' · ' + fmtSize(e.size) + ' (compressed ' + fmtSize(e.compressedSize) + ')' + (e.encrypted ? ' · ENCRYPTED — cannot be extracted' : '');
        box.appendChild(d);
      });
      $('ar-info').textContent = f + ' · ' + entries.length + ' entr(ies).';
    } catch (e) { /* already toasted */ }
  });
  $('ar-extract').addEventListener('click', async () => {
    if (!arZipPath) { toast('Open a ZIP first.', true); return; }
    const dir = await call(api.dialogs.pickFolder(), 'Extract to folder');
    if (!dir) return;
    try {
      const out = await call(api.archives.extract(arZipPath, dir), 'Extract ZIP');
      toast('Extracted ' + out.entries + ' file(s) to ' + out.destDir);
    } catch (e) { /* already toasted */ }
  });

  // ---------- converter ----------
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
  });
  $('cv-save').addEventListener('click', async () => {
    if (!$('cv-out').value) { toast('Nothing to save — convert something first.', true); return; }
    const target = await call(api.dialogs.pickSaveGeneric(undefined, [{ name: 'All files', extensions: ['*'] }]), 'Save output');
    if (!target) return;
    try { await call(api.editor.write(target, $('cv-out').value), 'Save output'); toast('Saved: ' + target); } catch (e) { /* already toasted */ }
  });

  // ---------- scan & OCR ----------
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
  async function cdRender() {
    const text = $('cd-text').value;
    if (!cdHighlightOn) { $('cd-preview').classList.add('hidden'); $('cd-text').classList.remove('hidden'); return; }
    try {
      const res = await api.highlight.render(text, $('cd-lang').value);
      if (res.ok) {
        $('cd-preview').innerHTML = res.value;
        $('cd-preview').classList.remove('hidden');
        $('cd-text').classList.add('hidden');
      }
    } catch (e) { /* preview failure leaves plain text visible */ }
  }
  let cdTimer = null;
  $('cd-text').addEventListener('input', () => { if (cdTimer) clearTimeout(cdTimer); cdTimer = setTimeout(cdRender, 300); });
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
      $('cd-text').value = out.text;
      $('cd-path').textContent = f;
      const ext = f.split('.').pop().toLowerCase();
      if (ext === 'py') $('cd-lang').value = 'python';
      else if (ext === 'kt' || ext === 'kts') $('cd-lang').value = 'kotlin';
      else $('cd-lang').value = 'javascript';
      await cdRender();
    } catch (e) { /* already toasted */ }
  });
  $('cd-save').addEventListener('click', async () => {
    if (!cdPath) { toast('Open a code file first, then save.', true); return; }
    try { await call(api.editor.write(cdPath, $('cd-text').value), 'Save code'); toast('Saved.'); } catch (e) { /* already toasted */ }
  });
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
      console.log('OMSUITE_RENDERER_READY');
    } catch (err) {
      toast('Startup failed: ' + err.message, true);
    }
  })();
})();

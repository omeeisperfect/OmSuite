package com.omsuite.android.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.documentfile.provider.DocumentFile
import com.omsuite.android.OmSuiteApp
import com.omsuite.android.data.BrowserItem
import com.omsuite.android.data.Favourite
import com.omsuite.android.data.GrantedFolder
import com.omsuite.android.data.RecentFile
import com.omsuite.android.util.FileUtils
import com.omsuite.android.util.SortDirection
import com.omsuite.android.util.SortField
import com.omsuite.android.util.SortOrder
import com.omsuite.android.util.SortableEntry
import com.omsuite.android.util.sortEntries
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.launch

@Composable
fun FilesScreen(app: OmSuiteApp, onOpenEditor: (String, String) -> Unit) {
    val scope = rememberCoroutineScope()
    val granted by app.db.folderDao().observeAll().collectAsState(initial = emptyList())
    val favourites by app.db.favouriteDao().observeAll().collectAsState(initial = emptyList())
    val favUris = favourites.map { it.uri }.toSet()

    var rootUri by remember { mutableStateOf<Uri?>(null) }
    var pathSegments by remember { mutableStateOf<List<String>>(emptyList()) }
    var items by remember { mutableStateOf<List<BrowserItem>>(emptyList()) }
    var query by remember { mutableStateOf("") }
    var sort by remember { mutableStateOf(SortOrder()) }
    var grid by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    val selected = remember { mutableStateListOf<String>() }
    var showCreateFolder by remember { mutableStateOf(false) }
    var showCreateFile by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf("") }
    var renameTarget by remember { mutableStateOf<BrowserItem?>(null) }
    var propsTarget by remember { mutableStateOf<BrowserItem?>(null) }
    var deleteTargets by remember { mutableStateOf<List<BrowserItem>?>(null) }
    var copyMoveTargets by remember { mutableStateOf<Pair<List<BrowserItem>, Boolean>?>(null) } // items, isMove
    var menuFor by remember { mutableStateOf<BrowserItem?>(null) }
    var conflictDialog by remember { mutableStateOf<ConflictDialogState?>(null) }
    val defaultFolderUri by app.settings.defaultFolderUri.collectAsState(initial = null)

    fun currentDir(): DocumentFile? {
        val root = rootUri?.let { app.files.rootFor(it) } ?: return null
        return app.files.childAt(root, pathSegments) ?: root
    }

    fun refresh() {
        val dir = currentDir() ?: return
        scope.launch {
            try {
                items = app.files.list(dir)
                error = null
            } catch (e: Exception) {
                error = "Could not list this folder: ${e.message}"
            }
        }
    }

    /** Copy/move with an explicit conflict policy — never silently overwrites. */
    suspend fun executeCopyMove(dest: DocumentFile, targets: List<BrowserItem>, isMove: Boolean, policy: ConflictPolicy) {
        if (dest.uri == currentDir()?.uri) {
            status = "That is the folder these items are already in — nothing was copied or moved."
            return
        }
        var done = 0
        var skipped = 0
        var failed = 0
        val destNames = app.files.childNames(dest).toMutableSet()
        for (t in targets) {
            val doc = DocumentFile.fromSingleUri(app, t.uri)
            if (doc == null) { failed++; continue }
            val conflict = t.name in destNames
            if (conflict && policy == ConflictPolicy.SKIP) { skipped++; continue }
            if (conflict && policy == ConflictPolicy.OVERWRITE) {
                app.files.findChild(dest, t.name)?.delete()
                destNames.remove(t.name)
            }
            val newName = if (conflict && policy == ConflictPolicy.KEEP_BOTH) {
                FileUtils.uniqueName(destNames, t.name)
            } else null
            val ok = if (isMove) app.files.move(doc, dest, newName) else app.files.copy(doc, dest, newName)
            if (ok) { done++; destNames.add(newName ?: t.name) } else failed++
        }
        status = "${if (isMove) "Moved" else "Copied"} $done item(s)" +
            (if (skipped > 0) ", skipped $skipped existing" else "") +
            (if (failed > 0) ", $failed failed" else "") + "."
        selected.clear()
        refresh()
    }

    // A default save location chosen in Settings opens automatically here
    // (only when it is still a granted folder and no folder is open yet).
    LaunchedEffect(granted, defaultFolderUri) {
        if (rootUri == null && defaultFolderUri != null &&
            granted.any { it.uri == defaultFolderUri }
        ) {
            rootUri = Uri.parse(defaultFolderUri)
        }
    }

    val treePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
            app.files.persistTreePermission(uri)
            scope.launch {
                val root = app.files.rootFor(uri)
                app.db.folderDao().add(GrantedFolder(uri.toString(), root?.name ?: "Folder", System.currentTimeMillis()))
            }
            rootUri = uri
            pathSegments = emptyList()
            selected.clear()
            refresh()
        }
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            scope.launch {
                val doc = DocumentFile.fromSingleUri(app, uri)
                val name = doc?.name ?: "file"
                app.db.recentDao().upsert(RecentFile(uri.toString(), name, System.currentTimeMillis(), doc?.length() ?: 0))
                if (FileUtils.isEditableText(name)) onOpenEditor(uri.toString(), name)
                else status = "Opened $name in Recents. Only text files (TXT/MD/JSON/XML/YAML/HTML) open in the editor yet."
            }
        }
    }

    LaunchedEffect(rootUri, pathSegments) { if (rootUri != null) refresh() }

    val filtered = items.filter { query.isBlank() || it.name.contains(query, ignoreCase = true) }
    val sorted = sortEntries(
        filtered.map { SortableEntry(it.name, it.isDir, it.size, it.modified) },
        sort
    ).mapNotNull { s -> filtered.firstOrNull { it.name == s.name && it.isDir == s.isDir } }

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = { treePicker.launch(null) }) { Text("Grant a folder") }
            Spacer(Modifier.padding(4.dp))
            OutlinedButton(onClick = { filePicker.launch(arrayOf("*/*")) }) { Text("Open a file") }
        }
        if (granted.isNotEmpty()) {
            Text("Granted folders (tap to browse):", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 8.dp))
            granted.forEach { folder ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "📁 ${folder.name}",
                        modifier = Modifier.weight(1f).clickable {
                            rootUri = Uri.parse(folder.uri); pathSegments = emptyList(); selected.clear()
                        }.padding(vertical = 2.dp),
                        color = MaterialTheme.colorScheme.primary
                    )
                    TextButton(onClick = {
                        scope.launch {
                            app.db.folderDao().remove(folder.uri)
                            app.files.releaseTreePermission(Uri.parse(folder.uri))
                            if (rootUri.toString() == folder.uri) {
                                rootUri = null; pathSegments = emptyList(); items = emptyList(); selected.clear()
                            }
                            status = "Removed granted folder ${folder.name} (files untouched)."
                        }
                    }) { Text("Remove") }
                }
            }
        }
        if (rootUri == null) {
            Spacer(Modifier.height(16.dp))
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("No folder open yet", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Tap “Grant a folder” and pick a folder on this device. OmSuite lists only " +
                            "real files from folders you grant — nothing here is sample data. " +
                            "You can also tap “Open a file” to open a single document.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
            return@Column
        }
        // Breadcrumbs
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
            IconButton(onClick = { if (pathSegments.isNotEmpty()) pathSegments = pathSegments.dropLast(1) }) {
                Icon(Icons.Filled.ArrowUpward, "Up")
            }
            Text(
                if (pathSegments.isEmpty()) "/" else "/" + pathSegments.joinToString("/"),
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f)
            )
            IconButton(onClick = { grid = !grid }) { Icon(if (grid) Icons.Filled.List else Icons.Filled.GridView, "Toggle view") }
        }
        OutlinedTextField(
            value = query, onValueChange = { query = it }, label = { Text("Search in this folder") },
            modifier = Modifier.fillMaxWidth()
        )
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(vertical = 4.dp)) {
            OutlinedButton(onClick = { showCreateFolder = true; newName = "" }) { Icon(Icons.Filled.CreateNewFolder, null); Text(" Folder") }
            OutlinedButton(onClick = { showCreateFile = true; newName = "note.txt" }) { Text("New file") }
            TextButton(onClick = {
                selected.clear()
                selected.addAll(sorted.map { it.uri.toString() })
            }) { Text("Select all") }
            DropdownMenuSort(sort) { sort = it }
        }
        if (selected.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("${selected.size} selected", modifier = Modifier.align(Alignment.CenterVertically))
                Button(onClick = { copyMoveTargets = Pair(items.filter { it.uri.toString() in selected }, false) }) { Text("Copy") }
                Button(onClick = { copyMoveTargets = Pair(items.filter { it.uri.toString() in selected }, true) }) { Text("Move") }
                Button(onClick = { deleteTargets = items.filter { it.uri.toString() in selected } }) { Icon(Icons.Filled.Delete, null); Text("Delete") }
                TextButton(onClick = { selected.clear() }) { Text("Clear") }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        Text("${sorted.size} item(s)", style = MaterialTheme.typography.bodySmall)
        if (sorted.isEmpty()) {
            Card(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text("This folder is empty", style = MaterialTheme.typography.titleSmall)
                    Text("Use “Folder” or “New file” above to create your first item here.", style = MaterialTheme.typography.bodySmall)
                }
            }
        } else if (grid) {
            LazyVerticalGrid(columns = GridCells.Fixed(2), modifier = Modifier.fillMaxSize()) {
                items(sorted) { item -> FileRow(app, item, favUris.contains(item.uri.toString()), selected.contains(item.uri.toString()),
                    onToggleSelect = { if (selected.contains(item.uri.toString())) selected.remove(item.uri.toString()) else selected.add(item.uri.toString()) },
                    onClick = {
                        if (item.isDir) { pathSegments = pathSegments + item.name; selected.clear() }
                        else scope.launch {
                            app.db.recentDao().upsert(RecentFile(item.uri.toString(), item.name, System.currentTimeMillis(), item.size))
                            if (FileUtils.isEditableText(item.name)) onOpenEditor(item.uri.toString(), item.name)
                            else status = "Only text files open in the editor yet. ${item.name} was added to Recents."
                        }
                    },
                    onMenu = { menuFor = item })
                }
            }
        } else {
            LazyColumn(Modifier.fillMaxSize()) {
                items(sorted) { item -> FileRow(app, item, favUris.contains(item.uri.toString()), selected.contains(item.uri.toString()),
                    onToggleSelect = { if (selected.contains(item.uri.toString())) selected.remove(item.uri.toString()) else selected.add(item.uri.toString()) },
                    onClick = {
                        if (item.isDir) { pathSegments = pathSegments + item.name; selected.clear() }
                        else scope.launch {
                            app.db.recentDao().upsert(RecentFile(item.uri.toString(), item.name, System.currentTimeMillis(), item.size))
                            if (FileUtils.isEditableText(item.name)) onOpenEditor(item.uri.toString(), item.name)
                            else status = "Only text files open in the editor yet. ${item.name} was added to Recents."
                        }
                    },
                    onMenu = { menuFor = item })
                }
            }
        }
    }

    // ---- dialogs ----
    if (showCreateFolder || showCreateFile) {
        val isFolder = showCreateFolder
        AlertDialog(
            onDismissRequest = { showCreateFolder = false; showCreateFile = false },
            title = { Text(if (isFolder) "Create folder" else "Create file") },
            text = {
                OutlinedTextField(value = newName, onValueChange = { newName = it }, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
            },
            confirmButton = {
                TextButton(onClick = {
                    val dir = currentDir()
                    if (dir != null && newName.isNotBlank()) {
                        scope.launch {
                            try {
                                if (isFolder) app.files.createFolder(dir, newName)
                                else {
                                    val created = app.files.createFile(dir, newName, FileUtils.mimeFor(newName))
                                    if (created != null) app.db.recentDao().upsert(RecentFile(created.uri.toString(), newName, System.currentTimeMillis(), 0))
                                }
                                status = "Created $newName"; refresh()
                            } catch (e: Exception) { error = "Create failed: ${e.message}" }
                        }
                    }
                    showCreateFolder = false; showCreateFile = false
                }) { Text("Create") }
            },
            dismissButton = { TextButton(onClick = { showCreateFolder = false; showCreateFile = false }) { Text("Cancel") } }
        )
    }
    renameTarget?.let { target ->
        var name by remember(target) { mutableStateOf(target.name) }
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text("Rename") },
            text = { OutlinedTextField(value = name, onValueChange = { name = it }, modifier = Modifier.fillMaxWidth()) },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        try {
                            val doc = DocumentFile.fromSingleUri(app, target.uri)
                            if (doc != null && app.files.rename(doc, name)) { status = "Renamed to $name"; refresh() }
                            else error = "Rename failed (the folder may be read-only)."
                        } catch (e: Exception) { error = "Rename failed: ${e.message}" }
                    }
                    renameTarget = null
                }) { Text("Rename") }
            },
            dismissButton = { TextButton(onClick = { renameTarget = null }) { Text("Cancel") } }
        )
    }
    propsTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { propsTarget = null },
            title = { Text(target.name) },
            text = {
                Text(
                    "Type: ${if (target.isDir) "Folder" else FileUtils.extension(target.name).ifBlank { "file" }}\n" +
                        "Size: ${if (target.isDir) "—" else FileUtils.formatSize(target.size)}\n" +
                        "Modified: ${if (target.modified > 0) DateFormat.getDateTimeInstance().format(Date(target.modified)) else "unknown"}\n" +
                        "Location: ${target.uri}"
                )
            },
            confirmButton = { TextButton(onClick = { propsTarget = null }) { Text("Close") } }
        )
    }
    deleteTargets?.let { targets ->
        AlertDialog(
            onDismissRequest = { deleteTargets = null },
            title = { Text("Delete ${targets.size} item(s)?") },
            text = { Text("This cannot be undone from OmSuite. Folders delete with everything inside them.") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        var failed = 0
                        for (t in targets) {
                            val doc = DocumentFile.fromSingleUri(app, t.uri)
                            if (doc == null || !app.files.delete(doc)) failed++
                        }
                        status = if (failed == 0) "Deleted ${targets.size} item(s)" else "Deleted with $failed failure(s)"
                        selected.clear(); refresh()
                    }
                    deleteTargets = null
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { deleteTargets = null }) { Text("Cancel") } }
        )
    }
    copyMoveTargets?.let { (targets, isMove) ->
        AlertDialog(
            onDismissRequest = { copyMoveTargets = null },
            title = { Text(if (isMove) "Move to…" else "Copy to…") },
            text = {
                Column {
                    Text("Destination folder (granted folders only):")
                    granted.forEach { folder ->
                        Text(
                            "📁 ${folder.name}",
                            modifier = Modifier.clickable {
                                scope.launch {
                                    val destRoot = app.files.rootFor(Uri.parse(folder.uri))
                                    if (destRoot != null) {
                                        val destNames = app.files.childNames(destRoot)
                                        val conflicts = targets.map { it.name }.filter { it in destNames }
                                        if (conflicts.isEmpty()) {
                                            executeCopyMove(destRoot, targets, isMove, ConflictPolicy.OVERWRITE)
                                        } else {
                                            conflictDialog = ConflictDialogState(destRoot, targets, isMove, conflicts)
                                        }
                                    } else error = "Could not open destination folder."
                                }
                                copyMoveTargets = null
                            }.padding(vertical = 6.dp),
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                    if (granted.isEmpty()) Text("No granted folders yet.")
                }
            },
            confirmButton = { TextButton(onClick = { copyMoveTargets = null }) { Text("Close") } }
        )
    }
    conflictDialog?.let { dialog ->
        AlertDialog(
            onDismissRequest = { conflictDialog = null },
            title = { Text("Name already exists") },
            text = {
                Text(
                    "${dialog.conflicts.size} item(s) already exist in the destination: " +
                        dialog.conflicts.joinToString(", ") +
                        ". Nothing has been overwritten yet — choose what to do."
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val d = dialog; conflictDialog = null
                    scope.launch { executeCopyMove(d.dest, d.targets, d.isMove, ConflictPolicy.KEEP_BOTH) }
                }) { Text("Keep both") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = {
                        val d = dialog; conflictDialog = null
                        scope.launch { executeCopyMove(d.dest, d.targets, d.isMove, ConflictPolicy.SKIP) }
                    }) { Text("Skip existing") }
                    TextButton(onClick = { conflictDialog = null }) { Text("Cancel") }
                    TextButton(onClick = {
                        val d = dialog; conflictDialog = null
                        scope.launch { executeCopyMove(d.dest, d.targets, d.isMove, ConflictPolicy.OVERWRITE) }
                    }) { Text("Overwrite") }
                }
            }
        )
    }
    menuFor?.let { item ->
        DropdownMenu(expanded = true, onDismissRequest = { menuFor = null }) {
            DropdownMenuItem(text = { Text("Properties") }, onClick = { propsTarget = item; menuFor = null })
            DropdownMenuItem(text = { Text("Rename") }, onClick = { renameTarget = item; menuFor = null })
            DropdownMenuItem(text = { Text("Duplicate here") }, onClick = {
                menuFor = null
                scope.launch {
                    val dir = currentDir(); val doc = DocumentFile.fromSingleUri(app, item.uri)
                    if (dir != null && doc != null) {
                        val newName = FileUtils.uniqueName(items.map { it.name }.toSet(), "Copy of ${item.name}")
                        val ok = app.files.copy(doc, dir, newName)
                        status = if (ok) "Duplicated ${item.name}" else "Duplicate failed"
                        refresh()
                    }
                }
            })
            DropdownMenuItem(text = { Text(if (favUris.contains(item.uri.toString())) "Unfavourite" else "Favourite") }, onClick = {
                menuFor = null
                scope.launch {
                    if (favUris.contains(item.uri.toString())) app.db.favouriteDao().remove(item.uri.toString())
                    else app.db.favouriteDao().add(Favourite(item.uri.toString(), item.name, System.currentTimeMillis()))
                }
            })
            DropdownMenuItem(text = { Text("Copy to…") }, onClick = { copyMoveTargets = Pair(listOf(item), false); menuFor = null })
            DropdownMenuItem(text = { Text("Move to…") }, onClick = { copyMoveTargets = Pair(listOf(item), true); menuFor = null })
            DropdownMenuItem(text = { Text("Delete") }, onClick = { deleteTargets = listOf(item); menuFor = null })
        }
    }
}

@Composable
private fun DropdownMenuSort(sort: SortOrder, onChange: (SortOrder) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        OutlinedButton(onClick = { expanded = true }) {
            Text("Sort: ${sort.field.name.lowercase()} ${if (sort.direction == SortDirection.ASC) "↑" else "↓"}")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            SortField.values().forEach { field ->
                DropdownMenuItem(text = { Text(field.name.lowercase()) }, onClick = { onChange(sort.copy(field = field)); expanded = false })
            }
            DropdownMenuItem(text = { Text("Reverse order") }, onClick = {
                onChange(sort.copy(direction = if (sort.direction == SortDirection.ASC) SortDirection.DESC else SortDirection.ASC))
                expanded = false
            })
        }
    }
}

@Composable
private fun FileRow(
    app: OmSuiteApp,
    item: BrowserItem,
    isFav: Boolean,
    isSelected: Boolean,
    onToggleSelect: () -> Unit,
    onClick: () -> Unit,
    onMenu: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp).clickable { onClick() }) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = isSelected, onCheckedChange = { onToggleSelect() })
            Icon(if (item.isDir) Icons.Filled.Folder else Icons.Filled.Description, null)
            Column(Modifier.weight(1f).padding(start = 8.dp)) {
                Text(item.name, style = MaterialTheme.typography.bodyMedium)
                Text(
                    if (item.isDir) "Folder" else {
                        "${FileUtils.formatSize(item.size)} • ${FileUtils.extension(item.name).ifBlank { "file" }}" +
                            if (item.modified > 0) " • ${DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(item.modified))}" else ""
                    },
                    style = MaterialTheme.typography.bodySmall
                )
            }
            if (isFav) Icon(Icons.Filled.Star, "Favourite")
            IconButton(onClick = onMenu) { Icon(Icons.Filled.MoreVert, "More") }
        }
    }
}


private enum class ConflictPolicy { OVERWRITE, KEEP_BOTH, SKIP }

private data class ConflictDialogState(
    val dest: DocumentFile,
    val targets: List<BrowserItem>,
    val isMove: Boolean,
    val conflicts: List<String>
)

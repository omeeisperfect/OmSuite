package com.omsuite.android.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.documentfile.provider.DocumentFile
import com.omsuite.android.OmSuiteApp
import com.omsuite.android.util.FileUtils
import com.omsuite.android.util.ZipUtils
import java.util.zip.ZipOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Archives: create a ZIP from SAF-picked files (java.util.zip) and extract a
 * picked ZIP into a SAF-picked folder. Entry names are safety-checked:
 * absolute paths and ".." segments are skipped and reported, never written
 * outside the chosen folder.
 */
@Composable
fun ArchiveScreen(app: OmSuiteApp) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pickedFiles by remember { mutableStateOf<List<Uri>>(emptyList()) }
    var zipName by remember { mutableStateOf("archive.zip") }
    var zipUri by remember { mutableStateOf<Uri?>(null) }
    var entries by remember { mutableStateOf<List<ZipUtils.EntryInfo>>(emptyList()) }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var selectedEntries by remember { mutableStateOf<Set<String>>(emptySet()) }
    var progress by remember { mutableStateOf<String?>(null) }
    var conflictDialog by remember { mutableStateOf<ConflictChoice?>(null) }

    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) {
            pickedFiles = uris
            status = "Picked ${uris.size} file(s) for the ZIP."
        }
    }
    val createZip = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        if (uri != null && pickedFiles.isNotEmpty()) {
            scope.launch(Dispatchers.IO) {
                try {
                    val resolver = context.contentResolver
                    resolver.openOutputStream(uri, "wt")?.use { out ->
                        ZipOutputStream(out).use { zip ->
                            val usedNames = mutableSetOf<String>()
                            var renamed = 0
                            var skipped = 0
                            for (fileUri in pickedFiles) {
                                val rawName = DocumentFile.fromSingleUri(context, fileUri)?.name
                                    ?: "file"
                                if (!FileUtils.isSafeArchiveEntry(rawName)) { skipped++; continue }
                                val name = FileUtils.uniqueName(usedNames, rawName)
                                if (name != rawName) renamed++
                                usedNames.add(name)
                                val bytes = resolver.openInputStream(fileUri)?.use { it.readBytes() }
                                    ?: continue
                                zip.putNextEntry(java.util.zip.ZipEntry(name))
                                zip.write(bytes)
                                zip.closeEntry()
                            }
                            withContext(Dispatchers.Main) {
                                status = "ZIP written with ${pickedFiles.size} picked file(s)" +
                                    (if (renamed > 0) " ($renamed renamed to avoid duplicate names in the ZIP)" else "") +
                                    (if (skipped > 0) " ($skipped unsafe names skipped)" else "") + "."
                                error = null
                            }
                        }
                    } ?: throw IllegalStateException("Could not open output")
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) { error = "ZIP creation failed: ${e.message}" }
                }
            }
        }
    }
    val pickZip = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            zipUri = uri
            scope.launch(Dispatchers.IO) {
                try {
                    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: throw IllegalStateException("Could not read ZIP")
                    val listed = ZipUtils.listEntries(bytes)
                    withContext(Dispatchers.Main) {
                        entries = listed
                        selectedEntries = emptySet()
                        status = "ZIP has ${listed.size} entr(ies). Tick entries to extract only some of them."
                        error = null
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) { error = "Could not list ZIP: ${e.message}" }
                }
            }
        }
    }
    /** Extract [wanted] (null = all) into [destRoot] with a conflict policy. */
    suspend fun runExtract(destRoot: DocumentFile, zip: Uri, wanted: Set<String>?, policy: ConflictPolicy) {
        try {
            val bytes = context.contentResolver.openInputStream(zip)?.use { it.readBytes() }
                ?: throw IllegalStateException("Could not read ZIP")
            val result = if (wanted == null) ZipUtils.extractAll(bytes) else ZipUtils.extractSelected(bytes, wanted)
            var written = 0
            var skipped = 0
            val total = result.files.size
            for ((index, entry) in result.files.entries.withIndex()) {
                val (name, data) = entry
                withContext(Dispatchers.Main) { progress = "Extracting ${index + 1} of $total: $name" }
                // Recreate subfolders segment by segment.
                var dir = destRoot
                var broken = false
                for (seg in name.split("/").dropLast(1)) {
                    dir = dir.findFile(seg) ?: dir.createDirectory(seg) ?: run { broken = true; dir }
                    if (broken) break
                }
                if (broken) continue
                val leaf = name.split("/").last()
                val existing = dir.findFile(leaf)
                if (existing != null) {
                    when (policy) {
                        ConflictPolicy.SKIP -> { skipped++; continue }
                        ConflictPolicy.OVERWRITE -> existing.delete()
                        ConflictPolicy.KEEP_BOTH -> {
                            val siblingNames = dir.listFiles().mapNotNull { it.name }.toSet()
                            val unique = FileUtils.uniqueName(siblingNames, leaf)
                            val target = dir.createFile(FileUtils.mimeFor(unique), unique)
                            if (target != null) {
                                context.contentResolver.openOutputStream(target.uri, "wt")?.use { it.write(data) }
                                written++
                            }
                            continue
                        }
                    }
                }
                val target = dir.createFile(FileUtils.mimeFor(leaf), leaf)
                if (target != null) {
                    context.contentResolver.openOutputStream(target.uri, "wt")?.use { it.write(data) }
                    written++
                }
            }
            withContext(Dispatchers.Main) {
                progress = null
                status = "Extracted $written file(s)." +
                    (if (skipped > 0) " Skipped $skipped existing file(s)." else "") +
                    if (result.skippedUnsafe.isNotEmpty()) {
                        " Skipped unsafe entries: ${result.skippedUnsafe.joinToString(", ")}"
                    } else ""
                error = null
            }
        } catch (e: Exception) {
            withContext(Dispatchers.Main) { progress = null; error = "Extraction failed: ${e.message}" }
        }
    }

    /** Check the destination for name clashes before extracting, then act. */
    fun startExtract(destUri: Uri, wanted: Set<String>?) {
        val zip = zipUri ?: return
        scope.launch(Dispatchers.IO) {
            try {
                val destRoot = DocumentFile.fromTreeUri(context, destUri)
                    ?: throw IllegalStateException("Could not open destination folder")
                val bytes = context.contentResolver.openInputStream(zip)?.use { it.readBytes() }
                    ?: throw IllegalStateException("Could not read ZIP")
                val names = if (wanted == null) ZipUtils.listEntries(bytes).map { it.name }
                    else ZipUtils.extractSelected(bytes, wanted).files.keys.toList()
                // Walk the destination tree to find which leaf names already exist.
                val conflicts = mutableListOf<String>()
                for (name in names) {
                    var dir = destRoot
                    var exists = true
                    val segments = name.split("/")
                    for (seg in segments.dropLast(1)) {
                        dir = dir.findFile(seg) ?: run { exists = false; dir }
                        if (!exists) break
                    }
                    if (exists && dir.findFile(segments.last()) != null) conflicts.add(name)
                }
                withContext(Dispatchers.Main) {
                    if (conflicts.isEmpty()) {
                        scope.launch(Dispatchers.IO) { runExtract(destRoot, zip, wanted, ConflictPolicy.OVERWRITE) }
                    } else {
                        conflictDialog = ConflictChoice(destRoot, zip, wanted, conflicts)
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { error = "Extraction failed: ${e.message}" }
            }
        }
    }

    val pickDestFolder = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) startExtract(uri, null)
    }
    val pickDestFolderSelected = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null && selectedEntries.isNotEmpty()) startExtract(uri, selectedEntries)
    }

    Column(Modifier.fillMaxSize().padding(12.dp).verticalScroll(rememberScrollState())) {
        Text("Archives", style = MaterialTheme.typography.headlineMedium)
        Text("Create ZIP files from picked files, or extract a ZIP into a folder you choose.", style = MaterialTheme.typography.bodySmall)
        Text("Create a ZIP", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
        Row(Modifier.padding(vertical = 4.dp)) {
            Button(onClick = { pickFiles.launch(arrayOf("*/*")) }) { Text("Pick files…") }
            OutlinedButton(
                onClick = { createZip.launch(zipName.ifBlank { "archive.zip" }) },
                enabled = pickedFiles.isNotEmpty(),
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Save ZIP…") }
        }
        if (pickedFiles.isNotEmpty()) {
            Text("Picked: ${pickedFiles.size} file(s)", style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(
                value = zipName, onValueChange = { zipName = it },
                label = { Text("ZIP file name") }, modifier = Modifier.fillMaxWidth()
            )
        }
        Text("Extract a ZIP", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp))
        Row(Modifier.padding(vertical = 4.dp)) {
            Button(onClick = { pickZip.launch(arrayOf("application/zip", "*/*")) }) { Text("Pick ZIP…") }
            OutlinedButton(
                onClick = { pickDestFolder.launch(null) },
                enabled = zipUri != null,
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Extract all to folder…") }
            OutlinedButton(
                onClick = { pickDestFolderSelected.launch(null) },
                enabled = zipUri != null && selectedEntries.isNotEmpty(),
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Extract selected (${selectedEntries.size})…") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        progress?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        if (entries.isNotEmpty()) {
            Text("Entries (tick to select for partial extraction):", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
            Row {
                OutlinedButton(onClick = {
                    selectedEntries = entries.filter { !it.isDirectory }.map { it.name }.toSet()
                }) { Text("Select all files") }
                OutlinedButton(onClick = { selectedEntries = emptySet() }, modifier = Modifier.padding(start = 4.dp)) { Text("Clear selection") }
            }
            entries.forEach { entry ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (!entry.isDirectory) {
                        Checkbox(
                            checked = entry.name in selectedEntries,
                            onCheckedChange = { checked ->
                                selectedEntries = if (checked) selectedEntries + entry.name else selectedEntries - entry.name
                            }
                        )
                    }
                    Text(
                        "• ${entry.name} — ${if (entry.isDirectory) "folder" else FileUtils.formatSize(entry.size)}",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.weight(1f)
                    )
                }
            }
            Text(
                "Unsafe entries (absolute paths or “..”) are never extracted; they are listed here and skipped on extract.",
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp)
            )
        }
    }

    conflictDialog?.let { dialog ->
        AlertDialog(
            onDismissRequest = { conflictDialog = null },
            title = { Text("Files already exist") },
            text = {
                Text(
                    "${dialog.conflicts.size} file(s) already exist in the destination: " +
                        dialog.conflicts.joinToString(", ") + ". Nothing has been overwritten yet."
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val d = dialog; conflictDialog = null
                    scope.launch(Dispatchers.IO) { runExtract(d.dest, d.zip, d.wanted, ConflictPolicy.KEEP_BOTH) }
                }) { Text("Keep both") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = {
                        val d = dialog; conflictDialog = null
                        scope.launch(Dispatchers.IO) { runExtract(d.dest, d.zip, d.wanted, ConflictPolicy.SKIP) }
                    }) { Text("Skip existing") }
                    TextButton(onClick = { conflictDialog = null }) { Text("Cancel") }
                    TextButton(onClick = {
                        val d = dialog; conflictDialog = null
                        scope.launch(Dispatchers.IO) { runExtract(d.dest, d.zip, d.wanted, ConflictPolicy.OVERWRITE) }
                    }) { Text("Overwrite") }
                }
            }
        )
    }
}

private data class ConflictChoice(
    val dest: DocumentFile,
    val zip: Uri,
    val wanted: Set<String>?,
    val conflicts: List<String>
)

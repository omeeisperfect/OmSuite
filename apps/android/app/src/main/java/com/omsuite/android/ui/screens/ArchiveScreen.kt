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
import androidx.compose.material3.Button
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
                            for (fileUri in pickedFiles) {
                                val name = DocumentFile.fromSingleUri(context, fileUri)?.name
                                    ?: "file"
                                if (!FileUtils.isSafeArchiveEntry(name)) continue
                                val bytes = resolver.openInputStream(fileUri)?.use { it.readBytes() }
                                    ?: continue
                                zip.putNextEntry(java.util.zip.ZipEntry(name))
                                zip.write(bytes)
                                zip.closeEntry()
                            }
                        }
                    } ?: throw IllegalStateException("Could not open output")
                    withContext(Dispatchers.Main) {
                        status = "ZIP written with ${pickedFiles.size} picked file(s) (unsafe names skipped)."
                        error = null
                    }
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
                        status = "ZIP has ${listed.size} entr(ies)."
                        error = null
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) { error = "Could not list ZIP: ${e.message}" }
                }
            }
        }
    }
    val pickDestFolder = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        val zip = zipUri
        if (uri != null && zip != null) {
            scope.launch(Dispatchers.IO) {
                try {
                    val destRoot = DocumentFile.fromTreeUri(context, uri)
                        ?: throw IllegalStateException("Could not open destination folder")
                    val bytes = context.contentResolver.openInputStream(zip)?.use { it.readBytes() }
                        ?: throw IllegalStateException("Could not read ZIP")
                    val result = ZipUtils.extractAll(bytes)
                    var written = 0
                    for ((name, data) in result.files) {
                        // Recreate subfolders segment by segment.
                        var dir = destRoot
                        val segments = name.split("/")
                        for (seg in segments.dropLast(1)) {
                            dir = dir.findFile(seg) ?: dir.createDirectory(seg) ?: break
                        }
                        val leaf = segments.last()
                        val target = dir.createFile(FileUtils.mimeFor(leaf), leaf)
                        if (target != null) {
                            context.contentResolver.openOutputStream(target.uri, "wt")?.use { it.write(data) }
                            written++
                        }
                    }
                    withContext(Dispatchers.Main) {
                        status = "Extracted $written file(s)." +
                            if (result.skippedUnsafe.isNotEmpty()) {
                                " Skipped unsafe entries: ${result.skippedUnsafe.joinToString(", ")}"
                            } else ""
                        error = null
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) { error = "Extraction failed: ${e.message}" }
                }
            }
        }
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
            ) { Text("Extract to folder…") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        if (entries.isNotEmpty()) {
            Text("Entries:", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
            entries.forEach { entry ->
                Text(
                    "• ${entry.name} — ${if (entry.isDirectory) "folder" else FileUtils.formatSize(entry.size)}",
                    style = MaterialTheme.typography.bodySmall
                )
            }
            Text(
                "Unsafe entries (absolute paths or “..”) are never extracted; they are listed here and skipped on extract.",
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp)
            )
        }
    }
}

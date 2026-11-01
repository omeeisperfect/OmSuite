package com.omsuite.android.ui.screens

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
import com.omsuite.android.util.EpubParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * E-books: EPUB via java.util.zip (no new library) — container.xml + OPF
 * spine chapters rendered as plain text — plus plain TXT books as fallback.
 * No DRM handling: DRM-protected EPUBs will fail to parse and say so.
 */
@Composable
fun EbookScreen(app: OmSuiteApp) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var bookTitle by remember { mutableStateOf("") }
    var chapters by remember { mutableStateOf<List<EpubParser.Chapter>>(emptyList()) }
    var chapterIndex by remember { mutableStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }

    fun openBytes(bytes: ByteArray, name: String, isEpub: Boolean) {
        try {
            if (isEpub) {
                val book = EpubParser.parse(bytes)
                bookTitle = book.title
                chapters = book.chapters
                chapterIndex = 0
                status = "Opened “${book.title}” — ${book.chapters.size} chapter(s)."
            } else {
                val text = bytes.toString(Charsets.UTF_8)
                bookTitle = name
                chapters = listOf(EpubParser.Chapter(name, name, text))
                chapterIndex = 0
                status = "Opened TXT book “$name”."
            }
            error = null
        } catch (e: Exception) {
            error = "Could not open this book: ${e.message}. " +
                "DRM-protected or malformed EPUBs cannot be read by this parser."
        }
    }

    val epubPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            scope.launch(Dispatchers.IO) {
                try {
                    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: throw IllegalStateException("Could not read file")
                    val name = DocumentFile.fromSingleUri(context, uri)?.name ?: "book.epub"
                    withContext(Dispatchers.Main) { openBytes(bytes, name, true) }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) { error = "Could not open EPUB: ${e.message}" }
                }
            }
        }
    }
    val txtPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            scope.launch(Dispatchers.IO) {
                try {
                    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: throw IllegalStateException("Could not read file")
                    val name = DocumentFile.fromSingleUri(context, uri)?.name ?: "book.txt"
                    withContext(Dispatchers.Main) { openBytes(bytes, name, false) }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) { error = "Could not open TXT book: ${e.message}" }
                }
            }
        }
    }

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("E-books", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Open an EPUB (chapters listed in spine order, XHTML rendered as plain text) " +
                "or a TXT book. Everything stays on this device.",
            style = MaterialTheme.typography.bodySmall
        )
        Row(Modifier.padding(vertical = 8.dp)) {
            Button(onClick = { epubPicker.launch(arrayOf("application/epub+zip", "*/*")) }) { Text("Open EPUB") }
            OutlinedButton(onClick = { txtPicker.launch(arrayOf("text/plain")) }, modifier = Modifier.padding(start = 4.dp)) { Text("Open TXT") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        if (chapters.isEmpty()) {
            Text("No book open yet.", modifier = Modifier.padding(top = 16.dp))
            return@Column
        }
        Text(bookTitle, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
        Row(Modifier.padding(vertical = 4.dp)) {
            OutlinedButton(onClick = { if (chapterIndex > 0) chapterIndex-- }, enabled = chapterIndex > 0) { Text("← Prev chapter") }
            OutlinedButton(
                onClick = { if (chapterIndex < chapters.lastIndex) chapterIndex++ },
                enabled = chapterIndex < chapters.lastIndex,
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Next chapter →") }
        }
        Text(
            "Chapters (${chapters.size}): " + chapters.mapIndexed { i, c ->
                if (i == chapterIndex) "[${c.title}]" else c.title
            }.joinToString(" • "),
            style = MaterialTheme.typography.bodySmall
        )
        val chapter = chapters[chapterIndex]
        Text(
            "Chapter ${chapterIndex + 1}: ${chapter.title}",
            style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp)
        )
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Text(chapter.text.ifBlank { "(This chapter has no readable text.)" }, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

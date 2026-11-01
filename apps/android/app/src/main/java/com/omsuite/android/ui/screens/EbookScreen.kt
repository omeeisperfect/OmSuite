package com.omsuite.android.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.documentfile.provider.DocumentFile
import com.omsuite.android.OmSuiteApp
import com.omsuite.android.util.EpubParser
import com.omsuite.android.util.SearchUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class ReaderTheme(val bg: Color, val fg: Color) { LIGHT(Color.White, Color.Black), SEPIA(Color(0xFFF5EAD6), Color(0xFF3E2723)), DARK(Color(0xFF121214), Color(0xFFEDEDED)) }

/**
 * E-books: EPUB via java.util.zip (no new library) — container.xml + OPF
 * spine chapters rendered as plain text — plus plain TXT books as fallback.
 * Reading position (chapter) is stored locally per book in SettingsStore and
 * restored on reopen. No DRM handling: DRM-protected EPUBs fail to parse
 * and say so. Chapters are plain text only: no images, styles or DRM.
 */
@Composable
fun EbookScreen(app: OmSuiteApp) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var bookId by remember { mutableStateOf<String?>(null) }
    var bookTitle by remember { mutableStateOf("") }
    var chapters by remember { mutableStateOf<List<EpubParser.Chapter>>(emptyList()) }
    var chapterIndex by remember { mutableStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var showToc by remember { mutableStateOf(false) }
    var fontSize by remember { mutableStateOf(17f) }
    var readerTheme by remember { mutableStateOf(ReaderTheme.LIGHT) }
    var searchQuery by remember { mutableStateOf("") }
    var searchResults by remember { mutableStateOf<List<Pair<Int, String>>>(emptyList()) }
    var restoredNote by remember { mutableStateOf<String?>(null) }

    // Reading position for the open book (chapter index as text), restored on open.
    // Unconditional collection: an empty bookId maps to a key that is never written.
    val bookmark by app.settings.bookmarkFor(bookId ?: "").collectAsState(initial = null)
    var resumedBook by remember { mutableStateOf<String?>(null) }

    /** Persist the current chapter as the reading position for this book. */
    fun savePosition(index: Int) {
        val id = bookId ?: return
        scope.launch {
            try {
                app.settings.setBookmark(id, index.toString())
            } catch (e: Exception) { /* position save must never break reading */ }
        }
    }

    fun goToChapter(index: Int) {
        if (index in chapters.indices) {
            chapterIndex = index
            savePosition(index)
        }
    }

    fun openBytes(bytes: ByteArray, name: String, isEpub: Boolean, id: String) {
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
            bookId = id
            resumedBook = null
            showToc = false
            searchQuery = ""
            searchResults = emptyList()
            restoredNote = null
            error = null
        } catch (e: Exception) {
            error = "Could not open this book: ${e.message}. " +
                "DRM-protected or malformed EPUBs cannot be read by this parser."
        }
    }

    // When a book opens and a saved position exists, resume there (once per book).
    LaunchedEffect(bookId, chapters.size, bookmark) {
        val id = bookId
        val saved = bookmark
        if (id != null && chapters.isNotEmpty() && saved != null && resumedBook != id) {
            resumedBook = id
            val index = saved.toIntOrNull()
            if (index != null && index in chapters.indices) {
                chapterIndex = index
                if (index != 0) {
                    restoredNote = "Resumed at chapter ${index + 1} (saved reading position)."
                }
            }
        }
    }

    val epubPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            scope.launch(Dispatchers.IO) {
                try {
                    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: throw IllegalStateException("Could not read file")
                    val name = DocumentFile.fromSingleUri(context, uri)?.name ?: "book.epub"
                    withContext(Dispatchers.Main) { openBytes(bytes, name, true, uri.toString()) }
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
                    withContext(Dispatchers.Main) { openBytes(bytes, name, false, uri.toString()) }
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
                "or a TXT book. Chapters are plain text only — EPUB images, styles and DRM content are not shown. " +
                "Everything stays on this device; your reading position is saved locally per book.",
            style = MaterialTheme.typography.bodySmall
        )
        Row(Modifier.padding(vertical = 8.dp)) {
            Button(onClick = { epubPicker.launch(arrayOf("application/epub+zip", "*/*")) }) { Text("Open EPUB") }
            OutlinedButton(onClick = { txtPicker.launch(arrayOf("text/plain")) }, modifier = Modifier.padding(start = 4.dp)) { Text("Open TXT") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        restoredNote?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        if (chapters.isEmpty()) {
            Text("No book open yet.", modifier = Modifier.padding(top = 16.dp))
            return@Column
        }
        Text(bookTitle, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
        val progress = if (chapters.isEmpty()) 0 else ((chapterIndex + 1) * 100 / chapters.size)
        Text(
            "Chapter ${chapterIndex + 1} of ${chapters.size} • $progress% through the book (by chapter)",
            style = MaterialTheme.typography.bodySmall
        )
        Row(Modifier.padding(vertical = 4.dp)) {
            OutlinedButton(onClick = { goToChapter(chapterIndex - 1) }, enabled = chapterIndex > 0) { Text("← Prev chapter") }
            OutlinedButton(
                onClick = { goToChapter(chapterIndex + 1) },
                enabled = chapterIndex < chapters.lastIndex,
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Next chapter →") }
            OutlinedButton(onClick = { showToc = !showToc }, modifier = Modifier.padding(start = 4.dp)) {
                Text(if (showToc) "Hide contents" else "Contents")
            }
        }
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Text("Text size:", style = MaterialTheme.typography.bodySmall)
            Slider(
                value = fontSize, onValueChange = { fontSize = it }, valueRange = 13f..26f,
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp)
            )
            Text("${fontSize.toInt()}sp", style = MaterialTheme.typography.bodySmall)
            ReaderTheme.values().forEach { theme ->
                OutlinedButton(
                    onClick = { readerTheme = theme },
                    modifier = Modifier.padding(start = 2.dp)
                ) { Text(if (readerTheme == theme) "● ${theme.name.lowercase()}" else theme.name.lowercase()) }
            }
        }
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            OutlinedTextField(
                value = searchQuery, onValueChange = { searchQuery = it },
                label = { Text("Search in this book") }, singleLine = true,
                modifier = Modifier.weight(1f)
            )
            OutlinedButton(onClick = {
                searchResults = if (searchQuery.isBlank()) {
                    emptyList()
                } else {
                    chapters.mapIndexedNotNull { index, chapter ->
                        val hits = SearchUtils.findOccurrences(chapter.text, searchQuery)
                        if (hits.isEmpty()) null else Pair(
                            index,
                            SearchUtils.snippet(chapter.text, hits.first(), searchQuery.length)
                        )
                    }
                }
            }, modifier = Modifier.padding(start = 4.dp)) { Text("Search") }
        }
        if (searchQuery.isNotBlank()) {
            if (searchResults.isEmpty()) {
                Text("No matches for “$searchQuery” in this book.", style = MaterialTheme.typography.bodySmall)
            } else {
                Text("${searchResults.size} chapter(s) match “$searchQuery” (tap to jump):", style = MaterialTheme.typography.bodySmall)
                Column {
                    searchResults.forEach { (index, snippet) ->
                        Text(
                            "${chapters[index].title}: $snippet",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.clickable { goToChapter(index) }.padding(vertical = 2.dp)
                        )
                    }
                }
            }
        }
        if (showToc) {
            Text("Table of contents:", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
            Column(Modifier.verticalScroll(rememberScrollState())) {
                chapters.forEachIndexed { index, chapter ->
                    val isBookmark = bookmark?.toIntOrNull() == index
                    Text(
                        "${if (index == chapterIndex) "▶ " else ""}Chapter ${index + 1}: ${chapter.title}" +
                            if (isBookmark) "  🔖 saved position" else "",
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (index == chapterIndex) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onBackground,
                        modifier = Modifier.clickable { goToChapter(index) }.padding(vertical = 4.dp)
                    )
                }
            }
            OutlinedButton(onClick = {
                val id = bookId
                if (id != null) {
                    scope.launch {
                        app.settings.clearBookmark(id)
                        status = "Saved reading position cleared for this book."
                    }
                }
            }, modifier = Modifier.padding(top = 4.dp)) { Text("Clear saved position") }
        } else {
            val chapter = chapters[chapterIndex]
            Text(
                "Chapter ${chapterIndex + 1}: ${chapter.title}",
                style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp)
            )
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                    .background(readerTheme.bg).padding(8.dp)
            ) {
                Text(
                    chapter.text.ifBlank { "(This chapter has no readable text.)" },
                    style = MaterialTheme.typography.bodyMedium,
                    fontSize = fontSize.sp,
                    color = readerTheme.fg
                )
            }
        }
    }
}

package com.omsuite.android.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.omsuite.android.OmSuiteApp
import com.omsuite.android.data.EditorDraft
import com.omsuite.android.data.RecentFile
import com.omsuite.android.util.FileUtils
import com.omsuite.android.util.JsonUtils
import com.omsuite.android.util.MarkdownParser
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Undo/redo over whole-text snapshots, capped to avoid unbounded memory. */
private class UndoStack(private val cap: Int = 100) {
    private val undo = ArrayDeque<String>()
    private val redo = ArrayDeque<String>()
    fun push(text: String) {
        if (undo.lastOrNull() == text) return
        undo.addLast(text)
        while (undo.size > cap) undo.removeFirst()
        redo.clear()
    }
    fun undo(current: String): String? {
        if (undo.isEmpty()) return null
        redo.addLast(current)
        return undo.removeLast()
    }
    fun redo(current: String): String? {
        if (redo.isEmpty()) return null
        undo.addLast(current)
        return redo.removeLast()
    }
    fun canUndo() = undo.isNotEmpty()
    fun canRedo() = redo.isNotEmpty()
}

/** Render **bold**, *italic* and `code` inside one paragraph. */
private fun inlineStyled(text: String): AnnotatedString = buildAnnotatedString {
    var i = 0
    while (i < text.length) {
        when {
            text.startsWith("**", i) -> {
                val end = text.indexOf("**", i + 2)
                if (end < 0) { append(text.substring(i)); break }
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(text.substring(i + 2, end)) }
                i = end + 2
            }
            text.startsWith("`", i) -> {
                val end = text.indexOf("`", i + 1)
                if (end < 0) { append(text.substring(i)); break }
                withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) { append(text.substring(i + 1, end)) }
                i = end + 1
            }
            text.startsWith("*", i) -> {
                val end = text.indexOf("*", i + 1)
                if (end < 0) { append(text.substring(i)); break }
                withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(text.substring(i + 1, end)) }
                i = end + 1
            }
            else -> { append(text[i]); i++ }
        }
    }
}

@Composable
fun EditorScreen(app: OmSuiteApp, initialUri: String?, initialName: String, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var docUri by remember { mutableStateOf(initialUri?.let { Uri.parse(it) }) }
    var docName by remember { mutableStateOf(initialName) }
    var text by remember { mutableStateOf("") }
    var loadedText by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var preview by remember { mutableStateOf(false) }
    var showFind by remember { mutableStateOf(false) }
    var findText by remember { mutableStateOf("") }
    var replaceText by remember { mutableStateOf("") }
    var confirmOverwrite by remember { mutableStateOf(false) }
    var showRecovery by remember { mutableStateOf<EditorDraft?>(null) }
    val undoStack = remember { UndoStack() }
    var autosaveJob by remember { mutableStateOf<Job?>(null) }

    val dirty = loadedText != null && text != loadedText || (loadedText == null && text.isNotEmpty())

    fun scheduleAutosave() {
        val uri = docUri ?: return
        autosaveJob?.cancel()
        autosaveJob = scope.launch {
            delay(2000)
            try {
                app.db.draftDao().save(EditorDraft(uri.toString(), docName, text, System.currentTimeMillis()))
            } catch (e: Exception) { /* autosave must never crash editing */ }
        }
    }

    LaunchedEffect(docUri) {
        val uri = docUri ?: run { loadedText = ""; return@LaunchedEffect }
        try {
            val draft = app.db.draftDao().get(uri.toString())
            val content = app.files.readText(uri)
            text = content
            loadedText = content
            if (draft != null && draft.content != content) showRecovery = draft
        } catch (e: Exception) {
            error = "Could not read this file: ${e.message}"
            loadedText = ""
        }
    }

    val saveAsPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
        if (uri != null) {
            scope.launch {
                try {
                    app.files.writeText(uri, text)
                    app.db.draftDao().delete(uri.toString())
                    docUri = uri
                    docName = docName.ifBlank { "document.txt" }
                    loadedText = text
                    app.db.recentDao().upsert(RecentFile(uri.toString(), docName, System.currentTimeMillis(), text.length.toLong()))
                    status = "Saved as a new file."
                } catch (e: Exception) { error = "Save failed: ${e.message}" }
            }
        }
    }

    fun save() {
        val uri = docUri
        if (uri == null) {
            saveAsPicker.launch(docName.ifBlank { "note.txt" })
            return
        }
        scope.launch {
            try {
                app.files.writeText(uri, text)
                app.db.draftDao().delete(uri.toString())
                loadedText = text
                app.db.recentDao().upsert(RecentFile(uri.toString(), docName, System.currentTimeMillis(), text.length.toLong()))
                status = "Saved."
            } catch (e: Exception) { error = "Save failed: ${e.message}" }
        }
    }

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = onBack) { Text("← Back") }
            Text(
                docName.ifBlank { "Untitled note" },
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp)
            )
            if (dirty) Text("• unsaved", style = MaterialTheme.typography.bodySmall) else Text("saved", style = MaterialTheme.typography.bodySmall)
        }
        Row {
            Button(onClick = {
                // Overwrite confirmation: only when saving over an existing file with changes.
                if (docUri != null && dirty) confirmOverwrite = true else save()
            }) { Text("Save") }
            Spacer(Modifier.padding(2.dp))
            OutlinedButton(onClick = { saveAsPicker.launch(docName.ifBlank { "note.txt" }) }) { Text("Save as…") }
            Spacer(Modifier.padding(2.dp))
            OutlinedButton(onClick = { showFind = !showFind }) { Text("Find") }
            Spacer(Modifier.padding(2.dp))
            OutlinedButton(onClick = { undoStack.undo(text)?.let { text = it } }, enabled = undoStack.canUndo()) { Text("Undo") }
            Spacer(Modifier.padding(2.dp))
            OutlinedButton(onClick = { undoStack.redo(text)?.let { text = it } }, enabled = undoStack.canRedo()) { Text("Redo") }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = preview, onCheckedChange = { preview = it })
            Text("Markdown preview")
            Spacer(Modifier.padding(8.dp))
            if (FileUtils.extension(docName) == "json") {
                OutlinedButton(onClick = {
                    val formatted = JsonUtils.formatJson(text)
                    if (formatted != null) { undoStack.push(text); text = formatted; status = "JSON formatted." }
                    else error = "Not valid JSON — nothing was changed."
                }) { Text("Format JSON") }
                Spacer(Modifier.padding(4.dp))
                Text(if (JsonUtils.isValidJson(text)) "JSON valid ✓" else "JSON invalid", style = MaterialTheme.typography.bodySmall)
            }
        }
        if (showFind) {
            OutlinedTextField(value = findText, onValueChange = { findText = it }, label = { Text("Find") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = replaceText, onValueChange = { replaceText = it }, label = { Text("Replace with") }, modifier = Modifier.fillMaxWidth())
            Row {
                Button(onClick = {
                    if (findText.isNotEmpty()) {
                        val count = text.split(findText).size - 1
                        undoStack.push(text); text = text.replace(findText, replaceText)
                        status = "Replaced $count occurrence(s)."
                    }
                }) { Text("Replace all") }
                Spacer(Modifier.padding(4.dp))
                TextButton(onClick = {
                    val idx = text.indexOf(findText)
                    status = if (findText.isEmpty()) "Type something to find."
                    else if (idx < 0) "Not found." else "Found at character $idx."
                }) { Text("Find next (count)") }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        if (preview) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                val blocks = MarkdownParser.parse(text)
                if (blocks.isEmpty()) Text("Nothing to preview yet.", style = MaterialTheme.typography.bodySmall)
                blocks.forEach { block ->
                    when (block.kind) {
                        MarkdownParser.BlockKind.HEADING1 -> Text(inlineStyled(block.text), style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(vertical = 4.dp))
                        MarkdownParser.BlockKind.HEADING2 -> Text(inlineStyled(block.text), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(vertical = 4.dp))
                        MarkdownParser.BlockKind.HEADING3 -> Text(inlineStyled(block.text), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(vertical = 4.dp))
                        MarkdownParser.BlockKind.BULLET -> Text("• " + inlineStyled(block.text).text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 12.dp, top = 2.dp, bottom = 2.dp))
                        MarkdownParser.BlockKind.NUMBERED -> Text("• " + inlineStyled(block.text).text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 12.dp, top = 2.dp, bottom = 2.dp))
                        MarkdownParser.BlockKind.QUOTE -> Text(inlineStyled(block.text), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.secondary, modifier = Modifier.padding(start = 12.dp, top = 2.dp, bottom = 2.dp))
                        MarkdownParser.BlockKind.RULE -> Text("———", style = MaterialTheme.typography.bodySmall)
                        MarkdownParser.BlockKind.CODE -> Text(block.text, fontFamily = FontFamily.Monospace, fontSize = 13.sp, modifier = Modifier.padding(8.dp))
                        MarkdownParser.BlockKind.PARAGRAPH -> Text(inlineStyled(block.text), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 2.dp))
                    }
                }
                Text(
                    "Preview supports headings, bold, italic, code, lists, quotes and code blocks. Other Markdown renders as plain text.",
                    style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 12.dp)
                )
            }
        } else {
            OutlinedTextField(
                value = text,
                onValueChange = { next ->
                    if (next != text) { undoStack.push(text); text = next; scheduleAutosave() }
                },
                modifier = Modifier.fillMaxSize(),
                placeholder = { Text("Start writing… (TXT, MD, JSON, XML, YAML, HTML)") }
            )
        }
    }

    if (confirmOverwrite) {
        AlertDialog(
            onDismissRequest = { confirmOverwrite = false },
            title = { Text("Overwrite ${docName}?") },
            text = { Text("Saving replaces the current contents of this file. The original cannot be recovered from OmSuite afterwards (an autosave draft exists only until the next successful save).") },
            confirmButton = { TextButton(onClick = { confirmOverwrite = false; save() }) { Text("Overwrite") } },
            dismissButton = { TextButton(onClick = { confirmOverwrite = false }) { Text("Cancel") } }
        )
    }
    showRecovery?.let { draft ->
        AlertDialog(
            onDismissRequest = { showRecovery = null },
            title = { Text("Recover unsaved draft?") },
            text = { Text("An autosaved draft of this file exists that differs from the saved file. Restoring replaces the editor text (the file on disk is untouched until you Save).") },
            confirmButton = {
                TextButton(onClick = { undoStack.push(text); text = draft.content; showRecovery = null; status = "Draft restored — press Save to keep it." }) { Text("Restore draft") }
            },
            dismissButton = {
                TextButton(onClick = {
                    scope.launch { app.db.draftDao().delete(draft.uri) }
                    showRecovery = null
                }) { Text("Discard draft") }
            }
        )
    }
}


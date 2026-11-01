package com.omsuite.android.ui.screens

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.documentfile.provider.DocumentFile
import com.omsuite.android.OmSuiteApp
import com.omsuite.android.util.FileUtils
import com.omsuite.android.util.PdfTextExtractor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * PDF Studio (viewer + best-effort text extraction).
 * Rendering uses android.graphics.pdf.PdfRenderer — no PDF library is vendored,
 * so merge/split are honestly Not implemented (disabled buttons with reasons).
 */
@Composable
fun PdfScreen(app: OmSuiteApp) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pdfUri by remember { mutableStateOf<Uri?>(null) }
    var pdfName by remember { mutableStateOf("") }
    var pageCount by remember { mutableStateOf(0) }
    var pageIndex by remember { mutableStateOf(0) }
    var zoom by remember { mutableStateOf(1.0f) }
    var bitmap by remember { mutableStateOf<Bitmap?>(null) }
    var extractedText by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    // Stable holder: picker coroutines outlive the composition that launched
    // them, so the renderer must NOT be read from composable state (stale
    // capture would silently render nothing). State vars below are UI-only.
    val holder = remember { PdfHolder() }

    fun closePdf() {
        try { holder.renderer?.close() } catch (e: Exception) { /* already closed */ }
        try { holder.pfd?.close() } catch (e: Exception) { /* already closed */ }
        holder.renderer = null; holder.pfd = null; bitmap = null; pageCount = 0
    }

    DisposableEffect(Unit) { onDispose { closePdf() } }

    fun renderPage(index: Int, scaleOverride: Float? = null) {
        val r = holder.renderer ?: return
        if (index !in 0 until r.pageCount) return
        scope.launch(Dispatchers.IO) {
            try {
                r.openPage(index).use { page ->
                    val scale = (scaleOverride ?: zoom).coerceIn(0.5f, 4f)
                    val width = (page.width * scale).toInt().coerceAtLeast(1)
                    val height = (page.height * scale).toInt().coerceAtLeast(1)
                    val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                    page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    withContext(Dispatchers.Main) {
                        // Recycle only the bitmap this holder last produced, never
                        // a bitmap another in-flight render may have just set.
                        holder.currentBitmap?.let { if (it != bmp) it.recycle() }
                        holder.currentBitmap = bmp
                        bitmap = bmp
                        pageIndex = index
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { error = "Could not render page: ${e.message}" }
            }
        }
    }

    val pickPdf = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            closePdf()
            scope.launch(Dispatchers.IO) {
                try {
                    val fd = context.contentResolver.openFileDescriptor(uri, "r")
                        ?: throw IllegalStateException("Could not open PDF")
                    val r = PdfRenderer(fd)
                    val name = DocumentFile.fromSingleUri(context, uri)?.name ?: "document.pdf"
                    holder.pfd = fd; holder.renderer = r
                    withContext(Dispatchers.Main) {
                        pdfUri = uri; pdfName = name
                        pageCount = r.pageCount; pageIndex = 0; extractedText = null
                        status = null; error = null
                    }
                    renderPage(0)
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) { error = "Could not open PDF: ${e.message}" }
                }
            }
        }
    }

    Column(Modifier.fillMaxSize().padding(12.dp).verticalScroll(rememberScrollState())) {
        Text("PDF Studio", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Pick a PDF on this device to view it page by page. Text extraction is " +
                "best-effort for simple PDFs (see the note under the extracted text).",
            style = MaterialTheme.typography.bodySmall
        )
        Row(Modifier.padding(vertical = 8.dp)) {
            Button(onClick = { pickPdf.launch(arrayOf("application/pdf")) }) { Text("Open PDF") }
            OutlinedButton(
                onClick = {
                    val uri = pdfUri
                    if (uri != null) {
                        scope.launch(Dispatchers.IO) {
                            try {
                                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                                    ?: throw IllegalStateException("Could not read PDF")
                                val text = PdfTextExtractor.extract(bytes)
                                withContext(Dispatchers.Main) {
                                    extractedText = text
                                    status = if (text.isBlank()) {
                                        "No extractable text found. This PDF may use custom-encoded fonts or scanned images, which this best-effort extractor cannot read."
                                    } else "Extracted ${text.length} character(s) (best-effort)."
                                }
                            } catch (e: Exception) {
                                withContext(Dispatchers.Main) { error = "Text extraction failed: ${e.message}" }
                            }
                        }
                    }
                },
                enabled = pdfUri != null,
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Extract text") }
        }
        Row(Modifier.padding(bottom = 4.dp)) {
            OutlinedButton(onClick = {}, enabled = false) { Text("Merge PDFs") }
            OutlinedButton(onClick = {}, enabled = false, modifier = Modifier.padding(start = 4.dp)) { Text("Split PDF") }
        }
        Text(
            "Merge and Split are Not implemented: no PDF library is vendored in this local-first app, " +
                "and PdfRenderer can only render pages, not rewrite PDF files. These buttons stay disabled rather than faking a result.",
            style = MaterialTheme.typography.bodySmall
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        val openUri = pdfUri
        if (openUri == null) {
            Text("No PDF open yet.", modifier = Modifier.padding(top = 16.dp))
        } else {
            Text(
                "$pdfName • $pageCount page(s) • page ${pageIndex + 1}",
                style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp)
            )
            Row(Modifier.padding(vertical = 4.dp)) {
                OutlinedButton(onClick = { renderPage(pageIndex - 1) }, enabled = pageIndex > 0) { Text("← Prev") }
                OutlinedButton(onClick = { renderPage(pageIndex + 1) }, enabled = pageIndex < pageCount - 1, modifier = Modifier.padding(start = 4.dp)) { Text("Next →") }
                OutlinedButton(
                    onClick = {
                        val next = (zoom - 0.25f).coerceAtLeast(0.5f)
                        zoom = next; renderPage(pageIndex, next)
                    },
                    modifier = Modifier.padding(start = 4.dp)
                ) { Text("Zoom −") }
                OutlinedButton(
                    onClick = {
                        val next = (zoom + 0.25f).coerceAtMost(4f)
                        zoom = next; renderPage(pageIndex, next)
                    },
                    modifier = Modifier.padding(start = 4.dp)
                ) { Text("Zoom +") }
            }
            Text("Zoom: ${"%.2f".format(zoom)}×  •  File size: ${DocumentFile.fromSingleUri(context, openUri)?.length()?.let { FileUtils.formatSize(it) } ?: "unknown"}", style = MaterialTheme.typography.bodySmall)
            bitmap?.let { Image(it.asImageBitmap(), "PDF page ${pageIndex + 1}", Modifier.fillMaxWidth().padding(top = 8.dp)) }
            extractedText?.let { text ->
                Text("Extracted text (best-effort — may be incomplete or out of order for complex PDFs):", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 16.dp))
                Text(text.ifBlank { "(no text extracted)" }, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/** Non-composable holder so coroutines always see the live PdfRenderer. */
private class PdfHolder {
    var renderer: PdfRenderer? = null
    var pfd: ParcelFileDescriptor? = null
    var currentBitmap: Bitmap? = null
}

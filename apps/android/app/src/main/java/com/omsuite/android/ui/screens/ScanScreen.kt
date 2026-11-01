package com.omsuite.android.ui.screens

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.pdf.PdfDocument
import android.net.Uri
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.omsuite.android.OmSuiteApp
import com.omsuite.android.util.ScanUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Scan & OCR: multi-page capture (camera preview or gallery images), with
 * per-page rotate, crop (margin sliders), reorder and delete. On-device ML
 * Kit Latin text recognition runs per page; recognised text lands in an
 * editable field for review/correction before saving. Export: TXT, or PDF
 * with one image page per scan page (platform PdfDocument — the PDF holds
 * page images, not a searchable text layer, and the UI says so).
 * Nothing is uploaded; recognition runs on this device.
 */
@Composable
fun ScanScreen(app: OmSuiteApp) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pages by remember { mutableStateOf<List<Bitmap>>(emptyList()) }
    var pageIndex by remember { mutableStateOf(0) }
    var recognised by remember { mutableStateOf("") }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var recognising by remember { mutableStateOf(false) }
    var cropLeft by remember { mutableStateOf(0f) }
    var cropTop by remember { mutableStateOf(0f) }
    var cropRight by remember { mutableStateOf(0f) }
    var cropBottom by remember { mutableStateOf(0f) }

    val currentPage: Bitmap? = pages.getOrNull(pageIndex)

    fun addPage(bmp: Bitmap) {
        pages = pages + bmp
        pageIndex = pages.lastIndex
        status = "Page ${pages.size} added (${pages.size} page(s) total)."
    }

    fun rotateCurrent() {
        val bmp = currentPage ?: return
        val matrix = Matrix().apply { postRotate(90f) }
        val rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, matrix, true)
        pages = pages.toMutableList().also { it[pageIndex] = rotated }
        status = "Page ${pageIndex + 1} rotated 90°."
    }

    fun cropCurrent() {
        val bmp = currentPage ?: return
        val rect = ScanUtils.cropRect(
            bmp.width, bmp.height,
            cropLeft.toInt(), cropTop.toInt(), cropRight.toInt(), cropBottom.toInt()
        )
        if (rect.width <= 0 || rect.height <= 0) {
            error = "Crop is empty — reduce the margins."
            return
        }
        val cropped = Bitmap.createBitmap(bmp, rect.left, rect.top, rect.width, rect.height)
        pages = pages.toMutableList().also { it[pageIndex] = cropped }
        cropLeft = 0f; cropTop = 0f; cropRight = 0f; cropBottom = 0f
        status = "Page ${pageIndex + 1} cropped."
        error = null
    }

    /** OCR pages one by one, concatenating results with page separators. */
    fun runOcrAll() {
        if (pages.isEmpty()) {
            error = "No pages to recognise yet."
            return
        }
        recognising = true
        error = null
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        val results = mutableListOf<String>()
        fun process(index: Int) {
            if (index >= pages.size) {
                recognised = results.mapIndexed { i, text -> "--- Page ${i + 1} ---\n$text" }
                    .joinToString("\n\n")
                status = if (recognised.isBlank()) {
                    "No text recognised in any page."
                } else {
                    "Recognised text from ${pages.size} page(s). Edit below, then save."
                }
                recognising = false
                return
            }
            try {
                recognizer.process(InputImage.fromBitmap(pages[index], 0))
                    .addOnSuccessListener { visionText ->
                        results.add(visionText.text)
                        process(index + 1)
                    }
                    .addOnFailureListener { e ->
                        error = "Text recognition failed on page ${index + 1}: ${e.message}. Pages before it were kept; no text was invented."
                        recognised = results.mapIndexed { i, text -> "--- Page ${i + 1} ---\n$text" }
                            .joinToString("\n\n")
                        recognising = false
                    }
            } catch (e: Exception) {
                error = "Text recognition is unavailable on this device: ${e.message}"
                recognising = false
            }
        }
        process(0)
    }

    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bmp ->
        if (bmp != null) {
            addPage(bmp)
            recognised = ""
        }
    }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) {
            try {
                val bmp = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
                if (bmp == null) {
                    error = "Could not decode this image."
                } else {
                    addPage(bmp)
                    recognised = ""
                }
            } catch (e: Exception) {
                error = "Could not read image: ${e.message}"
            }
        }
    }
    val saveTxtPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri ->
        if (uri != null) {
            scope.launch {
                try {
                    app.files.writeText(uri, recognised)
                    status = "Saved recognised text as TXT."
                } catch (e: Exception) { error = "Save failed: ${e.message}" }
            }
        }
    }
    val savePdfPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        if (uri != null && pages.isNotEmpty()) {
            scope.launch(Dispatchers.IO) {
                try {
                    val document = PdfDocument()
                    try {
                        for (bmp in pages) {
                            // One PDF page per scan page, scaled to fit A4 at 72dpi.
                            val pageWidth = 595
                            val pageHeight = 842
                            val scale = minOf(
                                pageWidth.toFloat() / bmp.width,
                                pageHeight.toFloat() / bmp.height
                            )
                            val drawWidth = (bmp.width * scale).toInt()
                            val drawHeight = (bmp.height * scale).toInt()
                            val info = PdfDocument.PageInfo.Builder(pageWidth, pageHeight, document.pages.size + 1).build()
                            val page = document.startPage(info)
                            val left = (pageWidth - drawWidth) / 2
                            val top = (pageHeight - drawHeight) / 2
                            page.canvas.drawBitmap(
                                Bitmap.createScaledBitmap(bmp, drawWidth, drawHeight, true),
                                left.toFloat(), top.toFloat(), null
                            )
                            document.finishPage(page)
                        }
                        context.contentResolver.openOutputStream(uri, "wt")?.use { out ->
                            document.writeTo(out)
                        } ?: throw IllegalStateException("Could not open output")
                    } finally {
                        document.close()
                    }
                    withContext(Dispatchers.Main) {
                        status = "Saved ${pages.size} page(s) as a PDF of page images (no searchable text layer — use TXT for the recognised text)."
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) { error = "PDF export failed: ${e.message}" }
                }
            }
        }
    }

    Column(Modifier.fillMaxSize().padding(12.dp).verticalScroll(rememberScrollState())) {
        Text("Scan & OCR", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Capture photos or pick images as pages, reorder/crop/rotate them, then run on-device ML Kit " +
                "text recognition (Latin script) into the editable field below. Nothing is uploaded.",
            style = MaterialTheme.typography.bodySmall
        )
        Row(Modifier.padding(vertical = 8.dp)) {
            Button(onClick = { cameraLauncher.launch(null) }) { Text("Take photo") }
            OutlinedButton(onClick = { imagePicker.launch("image/*") }, modifier = Modifier.padding(start = 4.dp)) { Text("Add image…") }
            OutlinedButton(
                onClick = { runOcrAll() },
                enabled = pages.isNotEmpty() && !recognising,
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Recognise all pages") }
        }
        if (recognising) Text("Recognising text…", style = MaterialTheme.typography.bodySmall)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        val page = currentPage
        if (page == null) {
            Text("No pages yet — take a photo or add an image.", modifier = Modifier.padding(top = 16.dp))
        } else {
            Text(
                "Page ${pageIndex + 1} of ${pages.size} • ${page.width}×${page.height}px",
                style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp)
            )
            Row(Modifier.padding(vertical = 4.dp)) {
                OutlinedButton(onClick = { if (pageIndex > 0) pageIndex-- }, enabled = pageIndex > 0) { Text("← Prev page") }
                OutlinedButton(
                    onClick = { if (pageIndex < pages.lastIndex) pageIndex++ },
                    enabled = pageIndex < pages.lastIndex,
                    modifier = Modifier.padding(start = 4.dp)
                ) { Text("Next page →") }
                OutlinedButton(onClick = { rotateCurrent() }, modifier = Modifier.padding(start = 4.dp)) { Text("Rotate 90°") }
                OutlinedButton(
                    onClick = {
                        pages = pages.toMutableList().also { it.removeAt(pageIndex) }
                        pageIndex = (pageIndex - 1).coerceAtLeast(0)
                        status = "Page deleted."
                    },
                    modifier = Modifier.padding(start = 4.dp)
                ) { Text("Delete page") }
            }
            Row(Modifier.padding(bottom = 4.dp)) {
                OutlinedButton(
                    onClick = {
                        if (pageIndex > 0) {
                            pages = pages.toMutableList().also {
                                val item = it.removeAt(pageIndex); it.add(pageIndex - 1, item)
                            }
                            pageIndex--
                        }
                    },
                    enabled = pageIndex > 0
                ) { Text("Move page up") }
                OutlinedButton(
                    onClick = {
                        if (pageIndex < pages.lastIndex) {
                            pages = pages.toMutableList().also {
                                val item = it.removeAt(pageIndex); it.add(pageIndex + 1, item)
                            }
                            pageIndex++
                        }
                    },
                    enabled = pageIndex < pages.lastIndex,
                    modifier = Modifier.padding(start = 4.dp)
                ) { Text("Move page down") }
            }
            Image(page.asImageBitmap(), "Scan page ${pageIndex + 1}", Modifier.fillMaxWidth().padding(top = 8.dp))
            Text("Crop margins (percent trimmed from each edge):", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 12.dp))
            listOf(
                Triple("Left", cropLeft, { v: Float -> cropLeft = v }),
                Triple("Top", cropTop, { v: Float -> cropTop = v }),
                Triple("Right", cropRight, { v: Float -> cropRight = v }),
                Triple("Bottom", cropBottom, { v: Float -> cropBottom = v })
            ).forEach { (label, value, set) ->
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Text("$label: ${value.toInt()}%", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(end = 4.dp))
                    Slider(value = value, onValueChange = set, valueRange = 0f..50f, modifier = Modifier.weight(1f))
                }
            }
            Button(onClick = { cropCurrent() }) { Text("Apply crop to this page") }
        }
        OutlinedTextField(
            value = recognised, onValueChange = { recognised = it },
            label = { Text("Recognised text (editable — review before saving)") },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
        )
        Row(Modifier.padding(top = 4.dp)) {
            Button(
                onClick = { saveTxtPicker.launch("scan.txt") },
                enabled = recognised.isNotEmpty()
            ) { Text("Save as TXT…") }
            OutlinedButton(
                onClick = { savePdfPicker.launch("scan.pdf") },
                enabled = pages.isNotEmpty(),
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Save pages as PDF…") }
            OutlinedButton(
                onClick = { recognised = ""; pages = emptyList(); pageIndex = 0; status = null; error = null },
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Clear") }
        }
        Text(
            "Notes: the camera capture returns a preview-size photo; for best recognition, pick full-resolution images from the gallery. " +
                "The PDF export contains page images only — it has no searchable text layer. For searchable text, save TXT.",
            style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)
        )
    }
}

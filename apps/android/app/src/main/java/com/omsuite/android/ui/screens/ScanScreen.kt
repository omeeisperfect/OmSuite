package com.omsuite.android.ui.screens

import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
import kotlinx.coroutines.launch

/**
 * Scan & OCR: capture with the camera (thumbnail preview contract — no
 * FileProvider setup needed) or pick an image, then run ML Kit on-device
 * Latin text recognition. Recognised text lands in an editable field and
 * can be saved as TXT. If recognition fails, the error is shown and no
 * text is invented: the field stays empty.
 */
@Composable
fun ScanScreen(app: OmSuiteApp) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var bitmap by remember { mutableStateOf<Bitmap?>(null) }
    var recognised by remember { mutableStateOf("") }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var recognising by remember { mutableStateOf(false) }

    fun runOcr(image: Bitmap) {
        recognising = true
        error = null
        try {
            val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
            recognizer.process(InputImage.fromBitmap(image, 0))
                .addOnSuccessListener { visionText ->
                    recognised = visionText.text
                    status = if (visionText.text.isBlank()) {
                        "No text recognised in this image."
                    } else {
                        "Recognised ${visionText.text.length} character(s). Edit below, then save."
                    }
                    recognising = false
                }
                .addOnFailureListener { e ->
                    error = "Text recognition failed: ${e.message}. The image is still shown above; no text was invented."
                    recognising = false
                }
        } catch (e: Exception) {
            error = "Text recognition is unavailable on this device: ${e.message}"
            recognising = false
        }
    }

    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bmp ->
        if (bmp != null) {
            bitmap = bmp
            recognised = ""
            status = "Photo captured — running on-device text recognition…"
            runOcr(bmp)
        }
    }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) {
            try {
                val bmp = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
                if (bmp == null) {
                    error = "Could not decode this image."
                } else {
                    bitmap = bmp
                    recognised = ""
                    status = "Image picked — running on-device text recognition…"
                    runOcr(bmp)
                }
            } catch (e: Exception) {
                error = "Could not read image: ${e.message}"
            }
        }
    }
    val savePicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri ->
        if (uri != null) {
            scope.launch {
                try {
                    app.files.writeText(uri, recognised)
                    status = "Saved recognised text as TXT."
                } catch (e: Exception) { error = "Save failed: ${e.message}" }
            }
        }
    }

    Column(Modifier.fillMaxSize().padding(12.dp).verticalScroll(rememberScrollState())) {
        Text("Scan & OCR", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Capture a photo or pick an image, and on-device ML Kit text recognition (Latin script) " +
                "reads the text into the editable field below. Nothing is uploaded; recognition runs on this device.",
            style = MaterialTheme.typography.bodySmall
        )
        Row(Modifier.padding(vertical = 8.dp)) {
            Button(onClick = { cameraLauncher.launch(null) }) { Text("Take photo") }
            OutlinedButton(onClick = { imagePicker.launch("image/*") }, modifier = Modifier.padding(start = 4.dp)) { Text("Pick image…") }
            OutlinedButton(
                onClick = { bitmap?.let { runOcr(it) } },
                enabled = bitmap != null && !recognising,
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Recognise again") }
        }
        if (recognising) Text("Recognising text…", style = MaterialTheme.typography.bodySmall)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        bitmap?.let { Image(it.asImageBitmap(), "Scanned image", Modifier.fillMaxWidth().padding(top = 8.dp)) }
            ?: Text("No image yet.", modifier = Modifier.padding(top = 16.dp))
        OutlinedTextField(
            value = recognised, onValueChange = { recognised = it },
            label = { Text("Recognised text (editable)") },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
        )
        Row(Modifier.padding(top = 4.dp)) {
            Button(
                onClick = { savePicker.launch("scan.txt") },
                enabled = recognised.isNotEmpty()
            ) { Text("Save as TXT…") }
            OutlinedButton(
                onClick = { recognised = ""; bitmap = null; status = null; error = null },
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Clear") }
        }
        Text(
            "Note: the camera capture returns a preview-size photo; for best recognition, pick a full-resolution image from the gallery instead.",
            style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)
        )
    }
}

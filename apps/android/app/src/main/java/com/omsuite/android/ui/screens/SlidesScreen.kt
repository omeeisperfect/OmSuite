package com.omsuite.android.ui.screens

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
import androidx.compose.material3.Card
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
import com.omsuite.android.OmSuiteApp
import com.omsuite.android.util.DeckExport
import com.omsuite.android.util.Slide
import kotlinx.coroutines.launch

/** A slide in the editor: content plus an optional SAF image Uri (stored as a string). */
private data class EditSlide(val title: String, val body: String, val imageUri: String? = null)

@Composable
fun SlidesScreen(app: OmSuiteApp) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var slides by remember { mutableStateOf(listOf(EditSlide("Untitled slide", ""))) }
    var selected by remember { mutableStateOf(0) }
    var presenting by remember { mutableStateOf(false) }
    var presentIndex by remember { mutableStateOf(0) }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && slides.isNotEmpty()) {
            val idx = selected.coerceIn(slides.indices)
            slides = slides.toMutableList().also { it[idx] = it[idx].copy(imageUri = uri.toString()) }
            status = "Image attached to slide ${idx + 1}."
        }
    }
    val exportPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/html")) { uri ->
        if (uri != null) {
            scope.launch {
                try {
                    val html = DeckExport.toHtml(slides.map { Slide(it.title, it.body) })
                    app.files.writeText(uri, html)
                    status = "Exported ${slides.size} slide(s) to a single HTML file."
                    error = null
                } catch (e: Exception) { error = "Export failed: ${e.message}" }
            }
        }
    }

    if (presenting) {
        val slide = slides.getOrNull(presentIndex)
        Column(Modifier.fillMaxSize().padding(24.dp)) {
            if (slide == null) {
                Text("No slides to present.")
            } else {
                Text("Slide ${presentIndex + 1} of ${slides.size}", style = MaterialTheme.typography.bodySmall)
                Text(slide.title, style = MaterialTheme.typography.headlineLarge, modifier = Modifier.padding(vertical = 16.dp))
                slide.imageUri?.let { uriString ->
                    val bitmap = remember(uriString) {
                        try {
                            context.contentResolver.openInputStream(Uri.parse(uriString))?.use {
                                BitmapFactory.decodeStream(it)
                            }
                        } catch (e: Exception) { null }
                    }
                    bitmap?.let { Image(it.asImageBitmap(), "Slide image", Modifier.fillMaxWidth().padding(bottom = 16.dp)) }
                }
                Text(slide.body, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()))
            }
            Row {
                OutlinedButton(
                    onClick = { if (presentIndex > 0) presentIndex-- },
                    enabled = presentIndex > 0
                ) { Text("← Previous") }
                OutlinedButton(
                    onClick = { if (presentIndex < slides.lastIndex) presentIndex++ },
                    enabled = presentIndex < slides.lastIndex,
                    modifier = Modifier.padding(start = 4.dp)
                ) { Text("Next →") }
                Button(onClick = { presenting = false }, modifier = Modifier.padding(start = 4.dp)) { Text("Exit") }
            }
        }
        return
    }

    Column(Modifier.fillMaxSize().padding(12.dp).verticalScroll(rememberScrollState())) {
        Text("Slides", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Build a deck: each slide has a title and body text, plus an optional image. " +
                "Present walks through slides fullscreen; Export writes one HTML file.",
            style = MaterialTheme.typography.bodySmall
        )
        Row(Modifier.padding(vertical = 8.dp)) {
            Button(onClick = {
                slides = slides + EditSlide("Untitled slide", "")
                selected = slides.lastIndex
            }) { Text("Add slide") }
            OutlinedButton(
                onClick = {
                    if (slides.isNotEmpty()) {
                        slides = slides.toMutableList().also { it.removeAt(selected) }
                        selected = (selected - 1).coerceAtLeast(0)
                    }
                },
                enabled = slides.isNotEmpty(),
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Delete") }
            OutlinedButton(
                onClick = {
                    if (selected > 0) {
                        slides = slides.toMutableList().also {
                            val item = it.removeAt(selected); it.add(selected - 1, item)
                        }
                        selected--
                    }
                },
                enabled = selected > 0,
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Move up") }
            OutlinedButton(
                onClick = {
                    if (selected < slides.lastIndex) {
                        slides = slides.toMutableList().also {
                            val item = it.removeAt(selected); it.add(selected + 1, item)
                        }
                        selected++
                    }
                },
                enabled = selected < slides.lastIndex,
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Move down") }
        }
        Row {
            Button(
                onClick = { presentIndex = 0; presenting = true },
                enabled = slides.isNotEmpty()
            ) { Text("▶ Present") }
            OutlinedButton(
                onClick = { exportPicker.launch("deck.html") },
                enabled = slides.isNotEmpty(),
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Export HTML") }
        }
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp)) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (slides.isEmpty()) {
            Text("No slides yet — tap “Add slide”.", modifier = Modifier.padding(top = 16.dp))
        }
        slides.forEachIndexed { index, slide ->
            Card(
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                onClick = { selected = index }
            ) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        "Slide ${index + 1}${if (index == selected) " — editing" else ""}",
                        style = MaterialTheme.typography.titleSmall
                    )
                    if (index == selected) {
                        OutlinedTextField(
                            value = slide.title,
                            onValueChange = { next ->
                                slides = slides.toMutableList().also { it[index] = it[index].copy(title = next) }
                            },
                            label = { Text("Title") },
                            modifier = Modifier.fillMaxWidth()
                        )
                        OutlinedTextField(
                            value = slide.body,
                            onValueChange = { next ->
                                slides = slides.toMutableList().also { it[index] = it[index].copy(body = next) }
                            },
                            label = { Text("Body text") },
                            modifier = Modifier.fillMaxWidth()
                        )
                        Row(Modifier.padding(top = 4.dp)) {
                            OutlinedButton(onClick = { imagePicker.launch(arrayOf("image/*")) }) {
                                Text(if (slide.imageUri == null) "Add image…" else "Change image…")
                            }
                            if (slide.imageUri != null) {
                                OutlinedButton(
                                    onClick = {
                                        slides = slides.toMutableList().also { it[index] = it[index].copy(imageUri = null) }
                                    },
                                    modifier = Modifier.padding(start = 4.dp)
                                ) { Text("Remove image") }
                            }
                        }
                    } else {
                        Text(slide.title, style = MaterialTheme.typography.bodyMedium)
                        if (slide.body.isNotBlank()) Text(slide.body, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        Text(
            "Note: exported HTML contains titles and body text. Attached images are not embedded in the HTML file.",
            style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)
        )
    }
}

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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.omsuite.android.OmSuiteApp
import com.omsuite.android.util.Converter
import kotlinx.coroutines.launch

/** The ONLY pairs offered: every other combination is not a working conversion. */
private val PAIRS = listOf(
    Pair("CSV", "JSON"),
    Pair("JSON", "CSV"),
    Pair("TXT", "MD"),
    Pair("JSON", "JSON") // pretty-print
)

private fun pairLabel(from: String, to: String): String =
    if (from == "JSON" && to == "JSON") "JSON → JSON (pretty-print)" else "$from → $to"

/**
 * Converter: only real conversions. Unsupported pairs show "Not supported"
 * and produce no output — never fabricated data.
 * TXT -> Markdown is a labelled heuristic (see the note under the button).
 */
@Composable
fun ConverterScreen(app: OmSuiteApp) {
    val scope = rememberCoroutineScope()
    val history by app.settings.conversionHistory.collectAsState(initial = emptyList())
    var input by remember { mutableStateOf("") }
    var output by remember { mutableStateOf("") }
    var pairIndex by remember { mutableStateOf(0) }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var pairMenu by remember { mutableStateOf(false) }
    val from = PAIRS[pairIndex].first
    val to = PAIRS[pairIndex].second

    val openPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            scope.launch {
                try {
                    input = app.files.readText(uri)
                    status = "Loaded input from file (source file untouched)."
                    error = null
                } catch (e: Exception) { error = "Could not read file: ${e.message}" }
            }
        }
    }
    val savePicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri ->
        if (uri != null) {
            scope.launch {
                try {
                    app.files.writeText(uri, output)
                    status = "Saved converted output."
                } catch (e: Exception) { error = "Save failed: ${e.message}" }
            }
        }
    }

    fun convert() {
        try {
            val result = Converter.convert(input, from, to)
            if (result == null) {
                // Unreachable with the pair-only selector, kept as a safety net.
                output = ""
                error = null
                status = "Not supported: $from → $to is not a real conversion in OmSuite."
            } else {
                output = result
                error = null
                status = when {
                    from == "TXT" && to == "MD" ->
                        "Converted with the TXT → Markdown heuristic (ALL-CAPS or “:” lines become headings). Formatting may be lost — the source file is untouched."
                    from == "JSON" && to == "JSON" -> "JSON pretty-printed."
                    else -> "Converted $from → $to. The source file/text is untouched."
                }
                scope.launch {
                    val stamp = java.text.DateFormat.getDateTimeInstance(
                        java.text.DateFormat.SHORT, java.text.DateFormat.SHORT
                    ).format(java.util.Date())
                    app.settings.addConversionHistory("${pairLabel(from, to)} • $stamp")
                }
            }
        } catch (e: Exception) {
            output = ""
            error = "Conversion failed: ${e.message}"
            status = null
        }
    }

    Column(Modifier.fillMaxSize().padding(12.dp).verticalScroll(rememberScrollState())) {
        Text("Converter", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Only verified conversions are offered here: CSV ↔ JSON, TXT → Markdown (heuristic, labelled as such), " +
                "and JSON pretty-print. No other pair is offered as working, and no output is ever fabricated. " +
                "Conversion may lose formatting — the source is never modified.",
            style = MaterialTheme.typography.bodySmall
        )
        Row(Modifier.padding(vertical = 8.dp)) {
            Column {
                OutlinedButton(onClick = { pairMenu = true }) { Text("Conversion: ${pairLabel(from, to)}") }
                DropdownMenu(expanded = pairMenu, onDismissRequest = { pairMenu = false }) {
                    PAIRS.forEachIndexed { index, pair ->
                        DropdownMenuItem(
                            text = { Text(pairLabel(pair.first, pair.second)) },
                            onClick = { pairIndex = index; pairMenu = false }
                        )
                    }
                }
            }
            OutlinedButton(onClick = { openPicker.launch(arrayOf("text/*")) }, modifier = Modifier.padding(start = 4.dp)) { Text("Open file…") }
        }
        Row {
            Button(onClick = { convert() }) { Text("Convert") }
            OutlinedButton(
                onClick = {
                    val ext = when (to) {
                        "JSON" -> "json"
                        "CSV" -> "csv"
                        "MD" -> "md"
                        else -> "txt"
                    }
                    savePicker.launch("converted.$ext")
                },
                enabled = output.isNotEmpty(),
                modifier = Modifier.padding(start = 4.dp)
            ) { Text("Save output…") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        OutlinedTextField(
            value = input, onValueChange = { input = it },
            label = { Text("Input ($from)") },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
        )
        OutlinedTextField(
            value = output, onValueChange = { output = it },
            label = { Text("Output ($to)") },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
        )
        Text(
            "Tip: paste CSV with a header row for CSV → JSON; paste an array of flat objects for JSON → CSV. " +
                "Nested JSON objects/arrays cannot become CSV rows and will report an error.",
            style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)
        )
        Text("Conversion history (stored on this device only):", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 16.dp))
        if (history.isEmpty()) {
            Text("No conversions yet.", style = MaterialTheme.typography.bodySmall)
        } else {
            history.forEach { entry ->
                Text("• $entry", style = MaterialTheme.typography.bodySmall)
            }
            OutlinedButton(onClick = {
                scope.launch { app.settings.clearConversionHistory(); status = "Conversion history cleared." }
            }, modifier = Modifier.padding(top = 4.dp)) { Text("Clear history") }
        }
    }
}

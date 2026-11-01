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

private val FORMATS = listOf("CSV", "JSON", "TXT", "MD")

/**
 * Converter: only real conversions. Unsupported pairs show "Not supported"
 * and produce no output — never fabricated data.
 * TXT -> Markdown is a labelled heuristic (see the note under the button).
 */
@Composable
fun ConverterScreen(app: OmSuiteApp) {
    val scope = rememberCoroutineScope()
    var input by remember { mutableStateOf("") }
    var output by remember { mutableStateOf("") }
    var from by remember { mutableStateOf("CSV") }
    var to by remember { mutableStateOf("JSON") }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var fromMenu by remember { mutableStateOf(false) }
    var toMenu by remember { mutableStateOf(false) }

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
                output = ""
                error = null
                status = "Not supported: $from → $to is not a real conversion in OmSuite. " +
                    "Supported: CSV ↔ JSON, TXT → Markdown (heuristic), JSON pretty-print."
            } else {
                output = result
                error = null
                status = when {
                    from == "TXT" && to == "MD" ->
                        "Converted with the TXT → Markdown heuristic (ALL-CAPS or “:” lines become headings)."
                    from == "JSON" && to == "JSON" -> "JSON pretty-printed."
                    else -> "Converted $from → $to."
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
            "Supported conversions only: CSV ↔ JSON, TXT → Markdown (heuristic, labelled as such), " +
                "and JSON pretty-print. Anything else shows “Not supported” — no fake output.",
            style = MaterialTheme.typography.bodySmall
        )
        Row(Modifier.padding(vertical = 8.dp)) {
            Column {
                OutlinedButton(onClick = { fromMenu = true }) { Text("From: $from") }
                DropdownMenu(expanded = fromMenu, onDismissRequest = { fromMenu = false }) {
                    FORMATS.forEach { fmt ->
                        DropdownMenuItem(text = { Text(fmt) }, onClick = { from = fmt; fromMenu = false })
                    }
                }
            }
            Text(" → ", modifier = Modifier.padding(horizontal = 4.dp))
            Column {
                OutlinedButton(onClick = { toMenu = true }) { Text("To: $to") }
                DropdownMenu(expanded = toMenu, onDismissRequest = { toMenu = false }) {
                    FORMATS.forEach { fmt ->
                        DropdownMenuItem(text = { Text(fmt) }, onClick = { to = fmt; toMenu = false })
                    }
                }
            }
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
    }
}

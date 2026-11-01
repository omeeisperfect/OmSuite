package com.omsuite.android.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.unit.dp
import com.omsuite.android.OmSuiteApp
import com.omsuite.android.util.Converter
import com.omsuite.android.util.FormulaEvaluator
import kotlinx.coroutines.launch

/** A cell's raw content; formulas start with '='. Display values are computed, never stored. */
@Composable
fun SheetsScreen(app: OmSuiteApp) {
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf(20) }
    var cols by remember { mutableStateOf(10) }
    var cells by remember { mutableStateOf<Map<Pair<Int, Int>, String>>(emptyMap()) }
    var selected by remember { mutableStateOf(Pair(0, 0)) }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    fun raw(col: Int, row: Int): String = cells[Pair(col, row)] ?: ""

    /**
     * Numeric value of the cell named by [ref], following formula refs.
     * [visiting] is the cycle guard: a ref already being resolved yields null.
     */
    fun numericValue(ref: String, visiting: Set<String>): Double? {
        if (ref in visiting) return null
        val (col, row) = FormulaEvaluator.parseRef(ref) ?: return null
        val content = raw(col, row).trim()
        if (content.isEmpty()) return null
        if (!content.startsWith("=")) return content.toDoubleOrNull()
        if (visiting.size > 100) return null
        return FormulaEvaluator.evaluate(content) { inner ->
            numericValue(inner, visiting + ref)
        }
    }

    /** Display text for a cell: formula results, raw text, or an error marker. */
    fun display(col: Int, row: Int): String {
        val content = raw(col, row)
        if (!content.trim().startsWith("=")) return content
        val value = FormulaEvaluator.evaluate(content.trim()) { inner ->
            numericValue(inner, setOf(FormulaEvaluator.refName(col, row)))
        }
        return when {
            value == null -> "#ERR"
            value % 1.0 == 0.0 -> value.toLong().toString()
            else -> value.toString()
        }
    }

    val openPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            scope.launch {
                try {
                    val text = app.files.readText(uri)
                    val parsed = Converter.parseCsv(text)
                    if (parsed.isEmpty()) { error = "CSV file is empty."; return@launch }
                    val newRows = maxOf(20, parsed.size)
                    val newCols = maxOf(10, parsed.maxOf { it.size })
                    val map = mutableMapOf<Pair<Int, Int>, String>()
                    parsed.forEachIndexed { r, row ->
                        row.forEachIndexed { c, value ->
                            if (value.isNotEmpty()) map[Pair(c, r)] = value
                        }
                    }
                    rows = newRows; cols = newCols; cells = map
                    status = "Loaded ${parsed.size} row(s) from CSV."
                    error = null
                } catch (e: Exception) { error = "Could not load CSV: ${e.message}" }
            }
        }
    }
    val savePicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri ->
        if (uri != null) {
            scope.launch {
                try {
                    // Export the used rectangle; formula cells save as computed values.
                    val usedRows = (0 until rows).filter { r -> (0 until cols).any { c -> raw(c, r).isNotEmpty() } }
                    val usedCols = (0 until cols).filter { c -> (0 until rows).any { r -> raw(c, r).isNotEmpty() } }
                    val exportRows = usedRows.map { r ->
                        usedCols.map { c ->
                            val content = raw(c, r)
                            if (content.trim().startsWith("=")) display(c, r) else content
                        }
                    }
                    app.files.writeText(uri, Converter.toCsv(exportRows))
                    status = "Saved CSV (${exportRows.size} row(s)). Formula cells were saved as their computed values."
                    error = null
                } catch (e: Exception) { error = "Save failed: ${e.message}" }
            }
        }
    }

    val selectedRaw = raw(selected.first, selected.second)
    val selectedDisplay = if (selectedRaw.trim().startsWith("=")) display(selected.first, selected.second) else selectedRaw

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("Sheets", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Tap a cell to edit it. Formulas start with = and support + - * / ( ), cell refs (A1) and SUM / AVERAGE over ranges, e.g. =SUM(A1:A5). Results recalculate on every edit.",
            style = MaterialTheme.typography.bodySmall
        )
        Row(Modifier.padding(vertical = 8.dp)) {
            Button(onClick = { openPicker.launch(arrayOf("text/csv", "text/*")) }) { Text("Open CSV") }
            OutlinedButton(onClick = { savePicker.launch("sheet.csv") }, modifier = Modifier.padding(start = 4.dp)) { Text("Save CSV") }
            OutlinedButton(onClick = { rows += 1 }, modifier = Modifier.padding(start = 4.dp)) { Text("+ Row") }
            OutlinedButton(onClick = { cols += 1 }, modifier = Modifier.padding(start = 4.dp)) { Text("+ Col") }
        }
        Text(
            "Selected ${FormulaEvaluator.refName(selected.first, selected.second)}: " +
                if (selectedRaw.trim().startsWith("=")) "$selectedRaw = $selectedDisplay" else selectedRaw.ifBlank { "(empty)" },
            style = MaterialTheme.typography.bodyMedium
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        val hScroll = rememberScrollState()
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).horizontalScroll(hScroll)) {
            // Header row.
            Row {
                Text("", modifier = Modifier.width(40.dp))
                for (c in 0 until cols) {
                    Text(
                        FormulaEvaluator.refName(c, 0).dropLastWhile { it.isDigit() },
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.width(120.dp).padding(2.dp)
                    )
                }
            }
            for (r in 0 until rows) {
                Row {
                    Text("${r + 1}", style = MaterialTheme.typography.labelSmall, modifier = Modifier.width(40.dp).padding(2.dp))
                    for (c in 0 until cols) {
                        val key = Pair(c, r)
                        // Editing shows the raw content; the value bar above shows the result.
                        OutlinedTextField(
                            value = raw(c, r),
                            onValueChange = { next ->
                                cells = cells.toMutableMap().apply {
                                    if (next.isEmpty()) remove(key) else put(key, next)
                                }
                                selected = key
                            },
                            singleLine = true,
                            modifier = Modifier.width(120.dp).padding(1.dp)
                        )
                    }
                }
            }
            Text(
                "Grid is $rows rows × $cols columns. Formulas that reference empty or text cells show #ERR.",
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)
            )
        }
    }
}

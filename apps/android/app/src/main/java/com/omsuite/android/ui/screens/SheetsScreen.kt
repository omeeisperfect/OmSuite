package com.omsuite.android.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.omsuite.android.OmSuiteApp
import com.omsuite.android.util.Converter
import com.omsuite.android.util.FormulaError
import com.omsuite.android.util.FormulaEvaluator
import com.omsuite.android.util.SheetFormatting
import com.omsuite.android.util.SheetNumberFormat
import com.omsuite.android.util.formulaErrorText
import com.omsuite.android.util.sortSheetRows
import kotlinx.coroutines.launch

/** One sheet tab: its own cells and grid size. */
private data class SheetTab(
    val name: String,
    val cells: Map<Pair<Int, Int>, String> = emptyMap(),
    val rows: Int = 20,
    val cols: Int = 10
)

/** A cell's raw content; formulas start with '='. Display values are computed, never stored. */
@Composable
fun SheetsScreen(app: OmSuiteApp) {
    val scope = rememberCoroutineScope()
    var tabs by remember { mutableStateOf(listOf(SheetTab("Sheet1"))) }
    var tabIndex by remember { mutableStateOf(0) }
    var selected by remember { mutableStateOf(Pair(0, 0)) }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var freezeHeader by remember { mutableStateOf(true) }
    var numberFormat by remember { mutableStateOf(SheetNumberFormat.GENERAL) }
    var filterQuery by remember { mutableStateOf("") }
    var sortColumn by remember { mutableStateOf("") }
    var sortAscending by remember { mutableStateOf(true) }
    var renameTab by remember { mutableStateOf(false) }
    var renameText by remember { mutableStateOf("") }

    val current = tabs.getOrNull(tabIndex) ?: SheetTab("Sheet1")
    val cells = current.cells
    val rows = current.rows
    val cols = current.cols

    fun updateCurrent(next: SheetTab) {
        tabs = tabs.toMutableList().also { it[tabIndex] = next }
    }
    fun setCell(key: Pair<Int, Int>, value: String) {
        val map = cells.toMutableMap()
        if (value.isEmpty()) map.remove(key) else map[key] = value
        updateCurrent(current.copy(cells = map))
    }
    fun raw(col: Int, row: Int): String = cells[Pair(col, row)] ?: ""

    /**
     * Numeric value of the cell named by [ref], following formula refs.
     * [visiting] is the cycle guard: a ref already being resolved throws
     * FormulaError("CIRC") so the cell shows #CIRC! instead of a generic error.
     */
    fun numericValue(ref: String, visiting: Set<String>): Double? {
        if (ref in visiting) throw FormulaError("CIRC")
        val (col, row) = FormulaEvaluator.parseRef(ref) ?: throw FormulaError("REF")
        val content = raw(col, row).trim()
        if (content.isEmpty()) return null
        if (!content.startsWith("=")) return content.toDoubleOrNull()
        if (visiting.size > 100) throw FormulaError("CIRC")
        return FormulaEvaluator.evaluateOrThrow(content) { inner ->
            numericValue(inner, visiting + ref)
        }
    }

    fun formatGeneral(value: Double): String =
        if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()

    /** Display text for a cell: formula results, formatted values, or a specific error marker. */
    fun display(col: Int, row: Int): String {
        val content = raw(col, row)
        if (!content.trim().startsWith("=")) {
            // Plain numbers/dates honour the sheet's display format; text is untouched.
            return when (numberFormat) {
                SheetNumberFormat.TWO_DECIMALS -> {
                    val num = content.trim().toDoubleOrNull()
                    if (num != null) SheetFormatting.formatNumber(num, 2) else content
                }
                SheetNumberFormat.DATE -> SheetFormatting.formatIsoDate(content.trim()) ?: content
                SheetNumberFormat.GENERAL -> content
            }
        }
        return try {
            val value = FormulaEvaluator.evaluateOrThrow(content.trim()) { inner ->
                numericValue(inner, setOf(FormulaEvaluator.refName(col, row)))
            }
            when (numberFormat) {
                SheetNumberFormat.TWO_DECIMALS -> SheetFormatting.formatNumber(value, 2)
                else -> formatGeneral(value)
            }
        } catch (e: FormulaError) {
            formulaErrorText(e.code)
        } catch (e: Exception) {
            "#ERR"
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
                    updateCurrent(current.copy(cells = map, rows = newRows, cols = newCols))
                    status = "Loaded ${parsed.size} row(s) from CSV into ${current.name}."
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
                    status = "Saved CSV (${exportRows.size} row(s)) from ${current.name}. Formula cells were saved as their computed values."
                    error = null
                } catch (e: Exception) { error = "Save failed: ${e.message}" }
            }
        }
    }

    val selectedRaw = raw(selected.first, selected.second)
    val selectedDisplay = if (selectedRaw.trim().startsWith("=")) display(selected.first, selected.second) else selectedRaw

    // Rows visible after the filter (row numbers stay the sheet's own numbers).
    val visibleRows = (0 until rows).filter { r ->
        filterQuery.isBlank() || (0 until cols).any { c -> raw(c, r).contains(filterQuery, ignoreCase = true) }
    }

    val headerContent: @Composable RowScope.() -> Unit = {
        Text("", modifier = Modifier.width(40.dp))
        for (c in 0 until cols) {
            Text(
                FormulaEvaluator.refName(c, 0).dropLastWhile { it.isDigit() },
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.width(120.dp).padding(2.dp)
            )
        }
    }

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("Sheets", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Tap a cell to edit it. Formulas start with = and support + - * / ( ), cell refs (A1) and " +
                "SUM / AVERAGE / MIN / MAX / COUNT over ranges, e.g. =SUM(A1:A5). Results recalculate on every edit. " +
                "Formula errors show in the cell: #DIV/0! divide by zero, #CIRC! circular reference, " +
                "#NAME? unknown function, #REF! bad reference, #VALUE! empty or non-numeric value.",
            style = MaterialTheme.typography.bodySmall
        )
        // Sheet tabs.
        Row(Modifier.padding(vertical = 4.dp)) {
            tabs.forEachIndexed { index, tab ->
                OutlinedButton(
                    onClick = { tabIndex = index },
                    modifier = Modifier.padding(end = 2.dp)
                ) { Text(if (index == tabIndex) "● ${tab.name}" else tab.name) }
            }
            OutlinedButton(onClick = {
                tabs = tabs + SheetTab("Sheet${tabs.size + 1}")
                tabIndex = tabs.lastIndex
            }) { Text("+ Sheet") }
            if (tabs.size > 1) {
                OutlinedButton(onClick = {
                    tabs = tabs.toMutableList().also { it.removeAt(tabIndex) }
                    tabIndex = (tabIndex - 1).coerceAtLeast(0)
                }, modifier = Modifier.padding(start = 2.dp)) { Text("Delete sheet") }
            }
            OutlinedButton(onClick = { renameText = current.name; renameTab = true }, modifier = Modifier.padding(start = 2.dp)) { Text("Rename") }
        }
        Row(Modifier.padding(vertical = 4.dp)) {
            Button(onClick = { openPicker.launch(arrayOf("text/csv", "text/*")) }) { Text("Open CSV") }
            OutlinedButton(onClick = { savePicker.launch("sheet.csv") }, modifier = Modifier.padding(start = 4.dp)) { Text("Save CSV") }
            OutlinedButton(onClick = { updateCurrent(current.copy(rows = rows + 1)) }, modifier = Modifier.padding(start = 4.dp)) { Text("+ Row") }
            OutlinedButton(onClick = { updateCurrent(current.copy(cols = cols + 1)) }, modifier = Modifier.padding(start = 4.dp)) { Text("+ Col") }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = freezeHeader, onCheckedChange = { freezeHeader = it })
            Text("Freeze header row")
            Spacer(Modifier.padding(4.dp))
            OutlinedTextField(
                value = filterQuery, onValueChange = { filterQuery = it },
                label = { Text("Filter rows") }, singleLine = true,
                modifier = Modifier.weight(1f)
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
            Text("Number format:", style = MaterialTheme.typography.bodySmall)
            SheetNumberFormat.values().forEach { fmt ->
                OutlinedButton(
                    onClick = { numberFormat = fmt },
                    modifier = Modifier.padding(start = 4.dp)
                ) { Text(if (numberFormat == fmt) "● ${fmt.name.lowercase()}" else fmt.name.lowercase()) }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = sortColumn, onValueChange = { sortColumn = it.uppercase() },
                label = { Text("Sort by column (A, B…)") }, singleLine = true,
                modifier = Modifier.weight(1f)
            )
            OutlinedButton(onClick = {
                val col = FormulaEvaluator.parseRef(sortColumn.trim() + "1")?.first
                if (col == null) {
                    error = "Sort needs a column letter, e.g. A."
                } else {
                    updateCurrent(current.copy(cells = sortSheetRows(cells, col, sortAscending)))
                    status = "Sorted by column ${sortColumn.trim().uppercase()} (${if (sortAscending) "ascending" else "descending"}). Row 1 stayed fixed as the header."
                    error = null
                }
            }, modifier = Modifier.padding(start = 4.dp)) { Text("Sort") }
            OutlinedButton(onClick = { sortAscending = !sortAscending }, modifier = Modifier.padding(start = 4.dp)) {
                Text(if (sortAscending) "↑ Asc" else "↓ Desc")
            }
        }
        Text(
            "Selected ${FormulaEvaluator.refName(selected.first, selected.second)}: " +
                if (selectedRaw.trim().startsWith("=")) "$selectedRaw = $selectedDisplay" else selectedRaw.ifBlank { "(empty)" },
            style = MaterialTheme.typography.bodyMedium
        )
        Text(
            "Showing ${visibleRows.size} of $rows row(s)${if (filterQuery.isNotBlank()) " matching “$filterQuery”" else ""}. " +
                "Number format changes display only — stored values are untouched. " +
                "Date format renders ISO dates (yyyy-MM-dd) as e.g. 1 Nov 2026.",
            style = MaterialTheme.typography.bodySmall
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }

        val hScroll = rememberScrollState()
        val vScroll = rememberScrollState()
        if (freezeHeader) {
            // Pinned header: shares the body's horizontal scroll state, so the
            // columns stay aligned while the header never scrolls away vertically.
            Row(Modifier.horizontalScroll(hScroll)) { headerContent() }
        }
        Column(Modifier.fillMaxSize().verticalScroll(vScroll).horizontalScroll(hScroll)) {
            if (!freezeHeader) {
                Row { headerContent() }
            }
            for (r in visibleRows) {
                Row {
                    Text("${r + 1}", style = MaterialTheme.typography.labelSmall, modifier = Modifier.width(40.dp).padding(2.dp))
                    for (c in 0 until cols) {
                        val key = Pair(c, r)
                        // The field edits raw content; computed results for formula
                        // cells in this row are shown in the line under the row,
                        // and for the selected cell in the bar above.
                        OutlinedTextField(
                            value = raw(c, r),
                            onValueChange = { next ->
                                setCell(key, next)
                                selected = key
                            },
                            singleLine = true,
                            modifier = Modifier.width(120.dp).padding(1.dp)
                        )
                    }
                }
                val formulaDisplays = (0 until cols).mapNotNull { c ->
                    val content = raw(c, r)
                    if (content.trim().startsWith("=")) {
                        "${FormulaEvaluator.refName(c, r)}: ${display(c, r)}"
                    } else null
                }
                if (formulaDisplays.isNotEmpty()) {
                    Text(
                        formulaDisplays.joinToString("  •  "),
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(start = 40.dp, bottom = 2.dp)
                    )
                }
            }
            Text(
                "Grid is $rows rows × $cols columns on ${current.name}. Formulas that reference empty or text cells show #VALUE!.",
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)
            )
        }
    }

    if (renameTab) {
        AlertDialog(
            onDismissRequest = { renameTab = false },
            title = { Text("Rename sheet") },
            text = {
                OutlinedTextField(value = renameText, onValueChange = { renameText = it }, modifier = Modifier.fillMaxWidth())
            },
            confirmButton = {
                TextButton(onClick = {
                    if (renameText.isNotBlank()) updateCurrent(current.copy(name = renameText))
                    renameTab = false
                }) { Text("Rename") }
            },
            dismissButton = { TextButton(onClick = { renameTab = false }) { Text("Cancel") } }
        )
    }
}

package com.omsuite.android.util

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Pure display formatting for Sheets cells plus row sorting.
 * Formatting is display-only: the stored raw cell text never changes.
 */
object SheetFormatting {

    private val isoRegex = Regex("^\\d{4}-\\d{2}-\\d{2}$")
    private val dateOut = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)

    fun isIsoDate(text: String): Boolean {
        if (!isoRegex.matches(text.trim())) return false
        return try {
            LocalDate.parse(text.trim()); true
        } catch (e: Exception) {
            false
        }
    }

    /** "2026-11-01" -> "1 Nov 2026", or null when not a valid ISO date. */
    fun formatIsoDate(iso: String): String? {
        return try {
            LocalDate.parse(iso.trim()).format(dateOut)
        } catch (e: Exception) {
            null
        }
    }

    /** Format a computed numeric value with [decimals] decimal places. */
    fun formatNumber(value: Double, decimals: Int): String {
        if (decimals <= 0) {
            return if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
        }
        return String.format(Locale.US, "%.${decimals}f", value)
    }
}

enum class SheetNumberFormat { GENERAL, TWO_DECIMALS, DATE }

/**
 * Sort data rows of a sheet by one column's values.
 * Row 0 is treated as the header and never moves. Only rows that contain
 * at least one non-empty cell take part; fully empty rows stay empty.
 * Comparison is numeric when both values parse as numbers, else
 * case-insensitive text comparison. Returns a new cell map.
 */
fun sortSheetRows(
    cells: Map<Pair<Int, Int>, String>,
    col: Int,
    ascending: Boolean
): Map<Pair<Int, Int>, String> {
    val maxRow = cells.keys.maxOfOrNull { it.second } ?: return cells
    if (maxRow < 1) return cells
    val participants = (1..maxRow).filter { r ->
        cells.any { (key, value) -> key.second == r && value.isNotEmpty() }
    }
    if (participants.size < 2) return cells
    fun valueAt(row: Int): String = cells[Pair(col, row)] ?: ""
    val sorted = participants.sortedWith { a, b ->
        val va = valueAt(a)
        val vb = valueAt(b)
        val na = va.toDoubleOrNull()
        val nb = vb.toDoubleOrNull()
        val cmp = if (na != null && nb != null) na.compareTo(nb)
            else va.lowercase().compareTo(vb.lowercase())
        if (ascending) cmp else -cmp
    }
    val out = cells.toMutableMap()
    // Clear participant rows, then write them back in sorted order.
    for (row in participants) {
        out.keys.filter { it.second == row }.forEach { out.remove(it) }
    }
    sorted.forEachIndexed { index, sourceRow ->
        val targetRow = participants[index]
        cells.filter { it.key.second == sourceRow }.forEach { (key, value) ->
            out[Pair(key.first, targetRow)] = value
        }
    }
    return out
}

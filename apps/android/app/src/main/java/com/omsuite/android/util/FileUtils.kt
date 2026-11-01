package com.omsuite.android.util

import java.text.DecimalFormat

/** Pure helpers — covered by JVM unit tests. No Android framework dependency. */
object FileUtils {
    private val fmt = DecimalFormat("#,##0.#")

    fun formatSize(bytes: Long): String {
        if (bytes < 0) return "—"
        if (bytes < 1024) return "$bytes B"
        val units = arrayOf("KB", "MB", "GB", "TB")
        var value = bytes.toDouble()
        var unit = -1
        while (value >= 1024 && unit < units.lastIndex) { value /= 1024; unit++ }
        return "${fmt.format(value)} ${units[unit]}"
    }

    fun extension(name: String): String {
        val dot = name.lastIndexOf('.')
        if (dot < 0 || dot == name.length - 1) return ""
        return name.substring(dot + 1).lowercase()
    }

    fun isEditableText(name: String): Boolean =
        extension(name) in setOf("txt", "md", "markdown", "json", "xml", "yaml", "yml", "html", "htm", "csv", "log", "ini", "toml")

    fun isArchive(name: String): Boolean =
        extension(name) in setOf("zip", "jar", "cbz")

    /** Guard used wherever archive entries are ever listed: reject traversal. */
    fun isSafeArchiveEntry(entryName: String): Boolean {
        if (entryName.isBlank()) return false
        if (entryName.startsWith("/") || entryName.startsWith("\\")) return false
        val parts = entryName.replace('\\', '/').split('/')
        return parts.none { it == ".." }
    }

    fun mimeFor(name: String): String = when (extension(name)) {
        "txt", "md", "log" -> "text/plain"
        "json" -> "application/json"
        "xml", "html", "htm" -> "text/html"
        "yaml", "yml" -> "text/yaml"
        "csv" -> "text/csv"
        "pdf" -> "application/pdf"
        "zip" -> "application/zip"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        else -> "*/*"
    }

    /** Split "report (1).txt" into ("report (1)", "txt"); no-dot names give ("name", ""). */
    fun splitNameExt(name: String): Pair<String, String> {
        val dot = name.lastIndexOf('.')
        if (dot <= 0 || dot == name.length - 1) return Pair(name, "")
        return Pair(name.substring(0, dot), name.substring(dot + 1))
    }

    /**
     * A name that does not collide with [existing]: "a.txt" -> "a (1).txt"
     * -> "a (2).txt" ... Never returns a name already in [existing].
     * Used for copy/move/duplicate and ZIP-entry conflicts instead of
     * silently overwriting.
     */
    fun uniqueName(existing: Set<String>, base: String): String {
        if (base !in existing) return base
        val (stem, ext) = splitNameExt(base)
        val suffix = if (ext.isEmpty()) "" else ".$ext"
        var n = 1
        while (true) {
            val candidate = "$stem ($n)$suffix"
            if (candidate !in existing) return candidate
            n++
        }
    }
}

enum class SortField { NAME, TYPE, SIZE, MODIFIED }
enum class SortDirection { ASC, DESC }
data class SortOrder(val field: SortField = SortField.NAME, val direction: SortDirection = SortDirection.ASC)

data class SortableEntry(
    val name: String, val isDir: Boolean, val size: Long, val modified: Long
)

/** Sort folders first, then by the chosen field. Pure function, unit-tested. */
fun sortEntries(entries: List<SortableEntry>, order: SortOrder): List<SortableEntry> {
    val cmp: Comparator<SortableEntry> = when (order.field) {
        SortField.NAME -> compareBy { it.name.lowercase() }
        SortField.TYPE -> compareBy { FileUtils.extension(it.name) }
        SortField.SIZE -> compareBy { it.size }
        SortField.MODIFIED -> compareBy { it.modified }
    }
    val sorted = entries.sortedWith(compareBy<SortableEntry> { !it.isDir }.then(cmp))
    return if (order.direction == SortDirection.DESC) sorted.sortedWith(
        compareBy<SortableEntry> { !it.isDir }.then(cmp.reversed())
    ) else sorted
}

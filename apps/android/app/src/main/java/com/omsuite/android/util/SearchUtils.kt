package com.omsuite.android.util

/** Pure, case-insensitive in-text search shared by PDF Studio and E-books. */
object SearchUtils {

    /** All non-overlapping match start indices of [query] in [text], or empty. */
    fun findOccurrences(text: String, query: String): List<Int> {
        if (query.isEmpty() || text.isEmpty()) return emptyList()
        val lower = text.lowercase()
        val needle = query.lowercase()
        val out = mutableListOf<Int>()
        var from = 0
        while (true) {
            val idx = lower.indexOf(needle, from)
            if (idx < 0) break
            out.add(idx)
            from = idx + needle.length
        }
        return out
    }

    /** Context snippet around the match at [index] (match length [matchLength]). */
    fun snippet(text: String, index: Int, matchLength: Int, context: Int = 40): String {
        if (text.isEmpty() || index !in text.indices) return ""
        val start = maxOf(0, index - context)
        val end = minOf(text.length, index + matchLength + context)
        val prefix = if (start > 0) "…" else ""
        val suffix = if (end < text.length) "…" else ""
        return prefix + text.substring(start, end).replace('\n', ' ') + suffix
    }
}

package com.omsuite.android.util

/**
 * Real, tested conversions only. Anything else returns null and the UI
 * shows "Not supported" — never fabricated output.
 * Supported pairs: CSV <-> JSON, TXT -> Markdown (labelled heuristic),
 * JSON -> JSON pretty-printed (via JsonUtils).
 * CSV dialect: comma-separated, double-quote escaping per RFC 4180.
 */
object Converter {

    /** Parse CSV text into rows of fields. Handles quoted fields, "" escapes, CRLF. */
    fun parseCsv(text: String): List<List<String>> {
        val rows = mutableListOf<List<String>>()
        var row = mutableListOf<String>()
        var field = StringBuilder()
        var inQuotes = false
        var i = 0
        fun endField() { row.add(field.toString()); field = StringBuilder() }
        fun endRow() { endField(); rows.add(row); row = mutableListOf() }
        while (i < text.length) {
            val c = text[i]
            when {
                inQuotes && c == '"' -> {
                    if (i + 1 < text.length && text[i + 1] == '"') { field.append('"'); i += 2 }
                    else { inQuotes = false; i++ }
                }
                inQuotes -> { field.append(c); i++ }
                c == '"' && field.isEmpty() -> { inQuotes = true; i++ }
                c == ',' -> { endField(); i++ }
                c == '\r' -> { i++ } // CRLF: \n below ends the row
                c == '\n' -> { endRow(); i++ }
                else -> { field.append(c); i++ }
            }
        }
        if (inQuotes) throw IllegalArgumentException("Unterminated quoted field")
        // Trailing row (ignore a single phantom row from a final newline).
        if (field.isNotEmpty() || row.isNotEmpty()) endRow()
        return rows.filter { it.any { f -> f.isNotEmpty() } }
    }

    fun toCsv(rows: List<List<String>>): String = rows.joinToString("\n") { row ->
        row.joinToString(",") { field ->
            if (field.contains(',') || field.contains('"') || field.contains('\n')) {
                "\"" + field.replace("\"", "\"\"") + "\""
            } else field
        }
    }

    /** CSV -> JSON: first row is the header; each later row becomes an object. Numbers stay numbers. */
    fun csvToJson(csv: String): String {
        val rows = parseCsv(csv)
        if (rows.isEmpty()) throw IllegalArgumentException("CSV is empty")
        val header = rows[0]
        val out = StringBuilder("[\n")
        rows.drop(1).forEachIndexed { idx, row ->
            out.append("  {")
            header.forEachIndexed { col, name ->
                if (col > 0) out.append(", ")
                val value = row.getOrNull(col) ?: ""
                out.append(jsonString(name)).append(": ").append(jsonScalar(value))
            }
            out.append("}")
            if (idx < rows.size - 2) out.append(",")
            out.append("\n")
        }
        out.append("]")
        return out.toString()
    }

    /** JSON -> CSV: input must be an array of flat objects (same parser family as JsonUtils). */
    fun jsonToCsv(json: String): String {
        val objects = parseJsonObjectArray(json)
        if (objects.isEmpty()) return ""
        val header = linkedSetOf<String>()
        objects.forEach { header.addAll(it.keys) }
        val rows = mutableListOf<List<String>>()
        rows.add(header.toList())
        for (obj in objects) {
            rows.add(header.map { obj[it] ?: "" })
        }
        return toCsv(rows)
    }

    /**
     * TXT -> Markdown, HEURISTIC (the UI labels it as such): a line in ALL CAPS
     * or ending with ':' becomes a heading; blank-line-separated blocks become
     * paragraphs; lines starting with "- " or "* " stay list items.
     */
    fun txtToMarkdown(txt: String): String {
        val out = StringBuilder()
        for (raw in txt.lines()) {
            val line = raw.trimEnd()
            when {
                line.isBlank() -> out.appendLine()
                line.startsWith("- ") || line.startsWith("* ") -> out.appendLine(line)
                line.length in 3..80 && line == line.uppercase() && line.any { it.isLetter() } ->
                    out.appendLine("## $line")
                line.endsWith(":") && !line.contains("://") && line.length <= 80 ->
                    out.appendLine("## ${line.dropLast(1)}")
                else -> out.appendLine(line)
            }
        }
        return out.toString().trimEnd() + "\n"
    }

    /**
     * Convert between formats. Returns null for unsupported pairs (UI shows
     * "Not supported"). Throws IllegalArgumentException on malformed input.
     */
    fun convert(input: String, from: String, to: String): String? {
        val f = from.uppercase()
        val t = to.uppercase()
        // JSON -> JSON is the pretty-print conversion, not an identity copy.
        if (f == "JSON" && t == "JSON") {
            return JsonUtils.formatJson(input)
                ?: throw IllegalArgumentException("Not valid JSON")
        }
        if (f == t) return input
        return when (f to t) {
            "CSV" to "JSON" -> csvToJson(input)
            "JSON" to "CSV" -> jsonToCsv(input)
            "TXT" to "MD" -> txtToMarkdown(input)
            else -> null
        }
    }

    private fun jsonString(s: String): String = buildString {
        append('"')
        for (c in s) {
            when (c) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> append(c)
            }
        }
        append('"')
    }

    private fun jsonScalar(value: String): String {
        if (value.isEmpty()) return "\"\""
        val num = value.toDoubleOrNull()
        if (num != null && value.matches(Regex("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?"))) {
            return value
        }
        if (value == "true" || value == "false" || value == "null") return value
        return jsonString(value)
    }

    // ---- Minimal JSON array-of-flat-objects parser (for JSON -> CSV only). ----
    private fun parseJsonObjectArray(json: String): List<Map<String, String>> {
        val text = json.trim()
        if (!text.startsWith("[")) throw IllegalArgumentException("JSON -> CSV needs an array of objects")
        val parser = JsonArrayParser(text)
        return parser.parseArray()
    }

    private class JsonArrayParser(private val s: String) {
        var i = 0
        private fun skipWs() { while (i < s.length && s[i].isWhitespace()) i++ }
        private fun expect(c: Char) {
            skipWs()
            if (i >= s.length || s[i] != c) throw IllegalArgumentException("Expected '$c' at $i")
            i++
        }
        fun parseArray(): List<Map<String, String>> {
            expect('[')
            val out = mutableListOf<Map<String, String>>()
            skipWs()
            if (i < s.length && s[i] == ']') { i++; return out }
            while (true) {
                out.add(parseObject())
                skipWs()
                when {
                    i < s.length && s[i] == ',' -> { i++; continue }
                    i < s.length && s[i] == ']' -> { i++; break }
                    else -> throw IllegalArgumentException("Expected ',' or ']' at $i")
                }
            }
            skipWs()
            if (i != s.length) throw IllegalArgumentException("Trailing content")
            return out
        }
        private fun parseObject(): Map<String, String> {
            expect('{')
            val map = linkedMapOf<String, String>()
            skipWs()
            if (i < s.length && s[i] == '}') { i++; return map }
            while (true) {
                val key = parseString()
                expect(':')
                map[key] = parseValue()
                skipWs()
                when {
                    i < s.length && s[i] == ',' -> { i++; continue }
                    i < s.length && s[i] == '}' -> { i++; break }
                    else -> throw IllegalArgumentException("Expected ',' or '}' at $i")
                }
            }
            return map
        }
        private fun parseString(): String {
            expect('"')
            val out = StringBuilder()
            while (i < s.length) {
                val c = s[i++]
                when (c) {
                    '"' -> return out.toString()
                    '\\' -> {
                        if (i >= s.length) break
                        when (val e = s[i++]) {
                            '"' -> out.append('"')
                            '\\' -> out.append('\\')
                            '/' -> out.append('/')
                            'b' -> out.append('\b')
                            'f' -> out.append('\u000C')
                            'n' -> out.append('\n')
                            'r' -> out.append('\r')
                            't' -> out.append('\t')
                            'u' -> {
                                out.append(s.substring(i, i + 4).toInt(16).toChar())
                                i += 4
                            }
                            else -> throw IllegalArgumentException("Bad escape")
                        }
                    }
                    else -> out.append(c)
                }
            }
            throw IllegalArgumentException("Unterminated string")
        }
        private fun parseValue(): String {
            skipWs()
            if (i >= s.length) throw IllegalArgumentException("Unexpected end")
            return when (s[i]) {
                '"' -> parseString()
                '{', '[' -> throw IllegalArgumentException("Nested objects/arrays are not supported for CSV")
                else -> {
                    val start = i
                    while (i < s.length && s[i] !in ",}] \t\r\n") i++
                    s.substring(start, i)
                }
            }
        }
    }
}

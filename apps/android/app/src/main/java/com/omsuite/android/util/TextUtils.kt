package com.omsuite.android.util

/**
 * JSON validation + pretty-printing with a small pure-Kotlin parser.
 * Deliberately NOT org.json: the android.jar stub throws in plain JVM unit
 * tests, so a self-contained parser keeps this genuinely testable in CI.
 * Supports objects, arrays, strings (with escapes), numbers, true/false/null.
 */
object JsonUtils {
    private sealed interface Node
    private data class Obj(val entries: List<Pair<String, Node>>) : Node
    private data class Arr(val items: List<Node>) : Node
    private data class Str(val value: String) : Node
    private data class Raw(val text: String) : Node // numbers, true, false, null

    private class Parser(private val s: String) {
        var i = 0
        fun parse(): Node {
            skipWs()
            val node = value()
            skipWs()
            if (i != s.length) throw IllegalArgumentException("Trailing content at $i")
            return node
        }
        private fun skipWs() { while (i < s.length && s[i].isWhitespace()) i++ }
        private fun expect(c: Char) {
            skipWs()
            if (i >= s.length || s[i] != c) throw IllegalArgumentException("Expected '$c' at $i")
            i++
        }
        private fun value(): Node {
            skipWs()
            if (i >= s.length) throw IllegalArgumentException("Unexpected end")
            return when (s[i]) {
                '{' -> {
                    i++
                    val entries = mutableListOf<Pair<String, Node>>()
                    skipWs()
                    if (i < s.length && s[i] == '}') { i++; return Obj(entries) }
                    while (true) {
                        val key = string()
                        expect(':')
                        entries.add(key to value())
                        skipWs()
                        when {
                            i < s.length && s[i] == ',' -> { i++; continue }
                            i < s.length && s[i] == '}' -> { i++; break }
                            else -> throw IllegalArgumentException("Expected ',' or '}' at $i")
                        }
                    }
                    Obj(entries)
                }
                '[' -> {
                    i++
                    val items = mutableListOf<Node>()
                    skipWs()
                    if (i < s.length && s[i] == ']') { i++; return Arr(items) }
                    while (true) {
                        items.add(value())
                        skipWs()
                        when {
                            i < s.length && s[i] == ',' -> { i++; continue }
                            i < s.length && s[i] == ']' -> { i++; break }
                            else -> throw IllegalArgumentException("Expected ',' or ']' at $i")
                        }
                    }
                    Arr(items)
                }
                '"' -> Str(string())
                else -> {
                    val start = i
                    while (i < s.length && s[i] !in ",}] \t\r\n") i++
                    val token = s.substring(start, i)
                    if (token.isEmpty() || (token != "true" && token != "false" && token != "null" &&
                            !token.matches(Regex("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?"))
                    )) throw IllegalArgumentException("Invalid token '$token'")
                    Raw(token)
                }
            }
        }
        private fun string(): String {
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
                                if (i + 4 > s.length) throw IllegalArgumentException("Bad unicode escape")
                                out.append(s.substring(i, i + 4).toInt(16).toChar())
                                i += 4
                            }
                            else -> throw IllegalArgumentException("Bad escape '\\$e'")
                        }
                    }
                    else -> out.append(c)
                }
            }
            throw IllegalArgumentException("Unterminated string")
        }
    }

    private fun escape(text: String): String = buildString {
        append('"')
        for (c in text) {
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

    private fun render(node: Node, indent: Int, out: StringBuilder) {
        val pad = "  ".repeat(indent)
        val padIn = "  ".repeat(indent + 1)
        when (node) {
            is Str -> out.append(escape(node.value))
            is Raw -> out.append(node.text)
            is Arr -> {
                if (node.items.isEmpty()) { out.append("[]"); return }
                out.append("[\n")
                node.items.forEachIndexed { idx, item ->
                    out.append(padIn); render(item, indent + 1, out)
                    if (idx < node.items.lastIndex) out.append(",")
                    out.append("\n")
                }
                out.append(pad).append("]")
            }
            is Obj -> {
                if (node.entries.isEmpty()) { out.append("{}"); return }
                out.append("{\n")
                node.entries.forEachIndexed { idx, (key, value) ->
                    out.append(padIn).append(escape(key)).append(": ")
                    render(value, indent + 1, out)
                    if (idx < node.entries.lastIndex) out.append(",")
                    out.append("\n")
                }
                out.append(pad).append("}")
            }
        }
    }

    fun isValidJson(text: String): Boolean = try {
        Parser(text.trim()).parse(); true
    } catch (e: Exception) { false }

    /** Returns formatted JSON, or null when invalid. Input must be an object/array. */
    fun formatJson(text: String): String? {
        return try {
            val trimmed = text.trim()
            if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) null
            else buildString { render(Parser(trimmed).parse(), 0, this) }
        } catch (e: Exception) { null }
    }
}

/** Minimal, genuinely-implemented Markdown subset for preview:
 *  headings (#, ##, ###), bold (**x**), italic (*x*), inline `code`,
 *  unordered lists (- / *), numbered lists, blockquotes (>), rules (---).
 *  Anything else renders as plain text — never faked as richer output. */
object MarkdownParser {
    enum class BlockKind { HEADING1, HEADING2, HEADING3, BULLET, NUMBERED, QUOTE, RULE, PARAGRAPH, CODE }

    data class Block(val kind: BlockKind, val text: String)

    fun parse(markdown: String): List<Block> {
        val blocks = mutableListOf<Block>()
        var inCode = false
        val codeBuf = StringBuilder()
        for (raw in markdown.lines()) {
            val line = raw.trimEnd()
            if (line.trimStart().startsWith("```")) {
                if (inCode) { blocks.add(Block(BlockKind.CODE, codeBuf.toString())); codeBuf.clear(); inCode = false }
                else inCode = true
                continue
            }
            if (inCode) { codeBuf.appendLine(line); continue }
            val t = line.trimStart()
            when {
                t.startsWith("### ") -> blocks.add(Block(BlockKind.HEADING3, t.removePrefix("### ")))
                t.startsWith("## ") -> blocks.add(Block(BlockKind.HEADING2, t.removePrefix("## ")))
                t.startsWith("# ") -> blocks.add(Block(BlockKind.HEADING1, t.removePrefix("# ")))
                t == "---" || t == "***" -> blocks.add(Block(BlockKind.RULE, ""))
                t.startsWith("- ") || t.startsWith("* ") -> blocks.add(Block(BlockKind.BULLET, t.drop(2)))
                t.matches(Regex("\\d+\\. .*")) -> blocks.add(Block(BlockKind.NUMBERED, t.substringAfter(". ")))
                t.startsWith("> ") -> blocks.add(Block(BlockKind.QUOTE, t.removePrefix("> ")))
                t.isBlank() -> Unit
                else -> blocks.add(Block(BlockKind.PARAGRAPH, t))
            }
        }
        if (inCode) blocks.add(Block(BlockKind.CODE, codeBuf.toString()))
        return blocks
    }
}

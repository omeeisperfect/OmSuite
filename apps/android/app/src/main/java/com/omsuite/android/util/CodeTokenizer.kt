package com.omsuite.android.util

/**
 * Pure syntax tokenizer for the Editor's code-highlight mode.
 * No Android dependency, JVM-testable. Languages: Kotlin, Python, JavaScript.
 * Token kinds are coarse on purpose: KEYWORD, STRING, COMMENT, NUMBER,
 * otherwise PLAIN. Highlight rendering maps kinds to colours in the UI layer.
 */
object CodeTokenizer {

    enum class Language { KOTLIN, PYTHON, JAVASCRIPT }
    enum class Kind { PLAIN, KEYWORD, STRING, COMMENT, NUMBER }

    data class Token(val kind: Kind, val text: String)

    private val kotlinKeywords = setOf(
        "as", "break", "class", "continue", "do", "else", "false", "for", "fun",
        "if", "import", "in", "interface", "is", "null", "object", "package",
        "return", "this", "throw", "true", "try", "catch", "finally", "typealias",
        "val", "var", "when", "while", "data", "sealed", "enum", "override",
        "private", "public", "internal", "protected", "suspend", "companion"
    )
    private val pythonKeywords = setOf(
        "and", "as", "assert", "break", "class", "continue", "def", "del",
        "elif", "else", "except", "False", "finally", "for", "from", "global",
        "if", "import", "in", "is", "lambda", "None", "not", "or", "pass",
        "raise", "return", "True", "try", "while", "with", "yield"
    )
    private val jsKeywords = setOf(
        "await", "break", "case", "catch", "class", "const", "continue",
        "debugger", "default", "delete", "do", "else", "export", "extends",
        "false", "finally", "for", "function", "if", "import", "in",
        "instanceof", "let", "new", "null", "return", "super", "switch",
        "this", "throw", "true", "try", "typeof", "var", "void", "while",
        "yield", "of"
    )

    private fun keywords(lang: Language): Set<String> = when (lang) {
        Language.KOTLIN -> kotlinKeywords
        Language.PYTHON -> pythonKeywords
        Language.JAVASCRIPT -> jsKeywords
    }

    /** Tokenize [code]. Line comments: // (Kotlin/JS), # (Python). Block comments: slash-star (Kotlin/JS). */
    fun tokenize(code: String, lang: Language): List<Token> {
        val kws = keywords(lang)
        val out = mutableListOf<Token>()
        var i = 0
        val plain = StringBuilder()
        fun flushPlain() {
            if (plain.isNotEmpty()) {
                out.add(Token(Kind.PLAIN, plain.toString()))
                plain.clear()
            }
        }
        while (i < code.length) {
            val c = code[i]
            // Line comment.
            val isLineComment = (lang != Language.PYTHON && code.startsWith("//", i)) ||
                (lang == Language.PYTHON && c == '#')
            if (isLineComment) {
                flushPlain()
                val end = code.indexOf('\n', i).let { if (it < 0) code.length else it }
                out.add(Token(Kind.COMMENT, code.substring(i, end)))
                i = end
                continue
            }
            // Block comment (Kotlin/JS only).
            if (lang != Language.PYTHON && code.startsWith("/*", i)) {
                flushPlain()
                val end = code.indexOf("*/", i + 2).let { if (it < 0) code.length else it + 2 }
                out.add(Token(Kind.COMMENT, code.substring(i, end)))
                i = end
                continue
            }
            // String literal: ' or " (Python also gets triple-quoted strings).
            if (c == '"' || c == '\'') {
                val triple = lang == Language.PYTHON && code.startsWith("$c$c$c", i)
                flushPlain()
                if (triple) {
                    val end = code.indexOf("$c$c$c", i + 3).let { if (it < 0) code.length else it + 3 }
                    out.add(Token(Kind.STRING, code.substring(i, end)))
                    i = end
                } else {
                    var j = i + 1
                    while (j < code.length && code[j] != c) {
                        if (code[j] == '\\' && j + 1 < code.length) j++
                        j++
                    }
                    val end = if (j < code.length) j + 1 else code.length
                    out.add(Token(Kind.STRING, code.substring(i, end)))
                    i = end
                }
                continue
            }
            // Number: digit run, allowing one dot and a decimal tail.
            if (c.isDigit()) {
                flushPlain()
                var j = i
                while (j < code.length && code[j].isDigit()) j++
                if (j < code.length && code[j] == '.' && j + 1 < code.length && code[j + 1].isDigit()) {
                    j++
                    while (j < code.length && code[j].isDigit()) j++
                }
                out.add(Token(Kind.NUMBER, code.substring(i, j)))
                i = j
                continue
            }
            // Word: keyword or plain.
            if (c.isLetter() || c == '_') {
                flushPlain()
                var j = i
                while (j < code.length && (code[j].isLetterOrDigit() || code[j] == '_')) j++
                val word = code.substring(i, j)
                out.add(Token(if (word in kws) Kind.KEYWORD else Kind.PLAIN, word))
                i = j
                continue
            }
            plain.append(c)
            i++
        }
        flushPlain()
        return out
    }
}

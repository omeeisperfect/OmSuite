package com.omsuite.android.util

/**
 * Pure spreadsheet formula evaluator. No Android dependency, JVM-testable.
 * Supports: numbers, + - * / (with unary minus), parentheses, cell refs
 * (A1 .. ZZ999, case-insensitive), SUM(range) and AVERAGE(range).
 * A formula is a string starting with '='; anything else is not a formula.
 * Returns null on any error (bad syntax, unknown ref, divide by zero,
 * circular reference — the caller detects cycles via the lookup depth).
 * Ranges are expanded column-major over the rectangle, e.g. A1:B2.
 */
object FormulaEvaluator {

    private val refRegex = Regex("^[A-Za-z]{1,2}[0-9]{1,3}$")
    private val rangeRegex = Regex("^([A-Za-z]{1,2}[0-9]{1,3}):([A-Za-z]{1,2}[0-9]{1,3})$")

    /** "A1" -> (colIndex 0-based, rowIndex 0-based), or null if malformed. */
    fun parseRef(ref: String): Pair<Int, Int>? {
        val r = ref.trim().uppercase()
        if (!refRegex.matches(r)) return null
        val letters = r.takeWhile { it.isLetter() }
        val digits = r.drop(letters.length)
        var col = 0
        for (c in letters) col = col * 26 + (c - 'A' + 1)
        val row = digits.toIntOrNull() ?: return null
        if (row < 1) return null
        return Pair(col - 1, row - 1)
    }

    /** (col, row) 0-based -> "A1" style ref. */
    fun refName(col: Int, row: Int): String {
        var n = col + 1
        val letters = StringBuilder()
        while (n > 0) {
            val rem = (n - 1) % 26
            letters.append('A' + rem)
            n = (n - 1) / 26
        }
        return letters.reverse().toString() + (row + 1)
    }

    /** Typed formula failure. Codes map to spreadsheet-style in-cell errors. */
class FormulaError(val code: String) : IllegalArgumentException(code)

/** Error code -> in-cell text shown by Sheets. */
fun formulaErrorText(code: String): String = when (code) {
    "DIV0" -> "#DIV/0!"
    "CIRC" -> "#CIRC!"
    "NAME" -> "#NAME?"
    "REF" -> "#REF!"
    "VALUE" -> "#VALUE!"
    else -> "#ERR"
}
    fun expandRange(start: String, end: String): List<String>? {
        val (c1, r1) = parseRef(start) ?: return null
        val (c2, r2) = parseRef(end) ?: return null
        val cols = minOf(c1, c2)..maxOf(c1, c2)
        val rows = minOf(r1, r2)..maxOf(r1, r2)
        if ((cols.count() * rows.count()) > 10_000) return null
        val out = mutableListOf<String>()
        for (row in rows) for (col in cols) out.add(refName(col, row))
        return out
    }

    /**
     * Evaluate [formula] (must start with '='). [lookup] returns the numeric
     * value of a cell ref, or null if the cell is empty/non-numeric. Callers
     * pass a lookup that resolves nested formulas with a depth/cycle guard.
     */
    fun evaluate(formula: String, lookup: (String) -> Double?): Double? {
        return try {
            evaluateOrThrow(formula, lookup)
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Like [evaluate] but throws [FormulaError] with a code (DIV0, CIRC,
     * NAME, REF, VALUE) so the UI can show a specific in-cell error instead
     * of crashing or showing a generic marker. A lookup may itself throw
     * FormulaError("CIRC") for a circular reference; it propagates untouched.
     */
    fun evaluateOrThrow(formula: String, lookup: (String) -> Double?): Double {
        val expr = formula.trim()
        if (!expr.startsWith("=")) throw FormulaError("VALUE")
        return Parser(expr.substring(1), lookup).parseAll()
    }

    private class Parser(private val s: String, private val lookup: (String) -> Double?) {
        var i = 0

        fun parseAll(): Double {
            val v = expr()
            skipWs()
            if (i != s.length) throw FormulaError("VALUE")
            return v
        }

        private fun skipWs() { while (i < s.length && s[i].isWhitespace()) i++ }

        private fun expr(): Double {
            var v = term()
            while (true) {
                skipWs()
                when {
                    i < s.length && s[i] == '+' -> { i++; v += term() }
                    i < s.length && s[i] == '-' -> { i++; v -= term() }
                    else -> return v
                }
            }
        }

        private fun term(): Double {
            var v = factor()
            while (true) {
                skipWs()
                when {
                    i < s.length && s[i] == '*' -> { i++; v *= factor() }
                    i < s.length && s[i] == '/' -> {
                        i++
                        val d = factor()
                        if (d == 0.0) throw FormulaError("DIV0")
                        v /= d
                    }
                    else -> return v
                }
            }
        }

        private fun factor(): Double {
            skipWs()
            if (i >= s.length) throw FormulaError("VALUE")
            return when (val c = s[i]) {
                '+' -> { i++; factor() }
                '-' -> { i++; -factor() }
                '(' -> {
                    i++
                    val v = expr()
                    skipWs()
                    if (i >= s.length || s[i] != ')') throw FormulaError("VALUE")
                    i++
                    v
                }
                in '0'..'9', '.' -> number()
                else -> {
                    if (c.isLetter()) wordOrRef() else throw FormulaError("VALUE")
                }
            }
        }

        private fun number(): Double {
            val start = i
            while (i < s.length && (s[i].isDigit() || s[i] == '.')) i++
            return s.substring(start, i).toDoubleOrNull()
                ?: throw FormulaError("VALUE")
        }

        /** A bare word is a cell ref; a word followed by '(' is a function call. */
        private fun wordOrRef(): Double {
            val start = i
            while (i < s.length && s[i].isLetter()) i++
            val word = s.substring(start, i).uppercase()
            skipWs()
            if (i < s.length && s[i] == '(') {
                i++
                val argsText = readUntilClosingParen()
                return callFunction(word, argsText)
            }
            // Cell ref: letters already read, now digits.
            val dStart = i
            while (i < s.length && s[i].isDigit()) i++
            val ref = word + s.substring(dStart, i)
            if (!refRegex.matches(ref)) throw FormulaError("REF")
            return lookup(ref) ?: throw FormulaError("VALUE")
        }

        /** Reads up to the matching ')' (no nested calls inside ranges, so a simple scan suffices). */
        private fun readUntilClosingParen(): String {
            val start = i
            var depth = 1
            while (i < s.length) {
                when (s[i]) {
                    '(' -> depth++
                    ')' -> {
                        depth--
                        if (depth == 0) {
                            val inner = s.substring(start, i)
                            i++ // consume ')'
                            return inner
                        }
                    }
                }
                i++
            }
            throw FormulaError("VALUE")
        }

        private fun callFunction(name: String, argsText: String): Double {
            val trimmed = argsText.trim()
            val rangeMatch = rangeRegex.matchEntire(trimmed)
            val refs: List<String> = if (rangeMatch != null) {
                expandRange(rangeMatch.groupValues[1], rangeMatch.groupValues[2])
                    ?: throw FormulaError("REF")
            } else if (refRegex.matches(trimmed.uppercase())) {
                listOf(trimmed.uppercase())
            } else {
                throw FormulaError("VALUE")
            }
            val values = refs.mapNotNull { lookup(it) }
            return when (name) {
                "SUM" -> values.sum()
                "MIN" -> values.minOrNull() ?: throw FormulaError("VALUE")
                "MAX" -> values.maxOrNull() ?: throw FormulaError("VALUE")
                "COUNT" -> values.size.toDouble()
                "AVERAGE" -> {
                    if (values.isEmpty()) throw FormulaError("VALUE")
                    values.average()
                }
                else -> throw FormulaError("NAME")
            }
        }
    }

}

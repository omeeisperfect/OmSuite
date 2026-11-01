package com.omsuite.android.util

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.InflaterInputStream

/**
 * Best-effort text extraction for simple PDFs, pure JVM (no PDF library).
 * How it works: every "stream ... endstream" block is tried as FlateDecode
 * (zlib) data and, failing that, used raw; literal (...) and hex <...>
 * strings followed by Tj, and arrays followed by TJ, are decoded and joined.
 * Honest limits (shown in the UI): it cannot read PDFs whose text is drawn
 * with custom-encoded fonts, embedded images, or encrypted content, and it
 * makes no claim about reading order beyond stream order.
 */
object PdfTextExtractor {

    /** Extract text from whole-PDF bytes. Returns "" when nothing decodable is found. */
    fun extract(pdfBytes: ByteArray): String {
        val out = StringBuilder()
        var searchFrom = 0
        while (true) {
            val streamIdx = indexOf(pdfBytes, "stream".toByteArray(), searchFrom)
            if (streamIdx < 0) break
            var dataStart = streamIdx + "stream".length
            // "stream" is followed by CRLF or LF.
            if (dataStart < pdfBytes.size && pdfBytes[dataStart] == '\r'.code.toByte()) dataStart++
            if (dataStart < pdfBytes.size && pdfBytes[dataStart] == '\n'.code.toByte()) dataStart++
            val endIdx = indexOf(pdfBytes, "endstream".toByteArray(), dataStart)
            if (endIdx < 0) break
            var dataEnd = endIdx
            // Trailing EOL before "endstream" is not part of the stream.
            if (dataEnd > dataStart && pdfBytes[dataEnd - 1] == '\n'.code.toByte()) dataEnd--
            if (dataEnd > dataStart && pdfBytes[dataEnd - 1] == '\r'.code.toByte()) dataEnd--
            val raw = pdfBytes.copyOfRange(dataStart, dataEnd)
            val decoded = tryInflate(raw) ?: raw
            val text = extractFromContentStream(decoded.toString(Charsets.ISO_8859_1))
            if (text.isNotBlank()) {
                if (out.isNotEmpty()) out.append("\n")
                out.append(text)
            }
            searchFrom = endIdx + "endstream".length
        }
        return out.toString().trim()
    }

    private fun tryInflate(raw: ByteArray): ByteArray? {
        return try {
            InflaterInputStream(ByteArrayInputStream(raw)).use { input ->
                val buf = ByteArrayOutputStream()
                val chunk = ByteArray(4096)
                var n = input.read(chunk)
                while (n >= 0) {
                    buf.write(chunk, 0, n)
                    n = input.read(chunk)
                }
                val result = buf.toByteArray()
                // InflaterInputStream on non-zlib data throws; a zero-length
                // result means "not actually Flate data" here.
                if (result.isEmpty()) null else result
            }
        } catch (e: Exception) {
            null
        }
    }

    /** Decode Tj / TJ text-showing operators inside one content stream. */
    fun extractFromContentStream(stream: String): String {
        val out = StringBuilder()
        var i = 0
        fun appendPiece(piece: String) {
            if (piece.isNotEmpty()) {
                if (out.isNotEmpty()) out.append(" ")
                out.append(piece)
            }
        }
        while (i < stream.length) {
            when (stream[i]) {
                '(' -> {
                    val (literal, end) = readLiteral(stream, i)
                    i = end
                    val rest = stream.substring(i).trimStart()
                    if (rest.startsWith("Tj")) {
                        appendPiece(literal)
                        i += stream.substring(i).indexOf("Tj") + 2
                    }
                }
                '[' -> {
                    val (pieces, end) = readArray(stream, i)
                    i = end
                    val rest = stream.substring(i).trimStart()
                    if (rest.startsWith("TJ")) {
                        pieces.forEach { appendPiece(it) }
                        i += stream.substring(i).indexOf("TJ") + 2
                    }
                }
                else -> i++
            }
        }
        return out.toString()
    }

    private fun readLiteral(s: String, start: Int): Pair<String, Int> {
        val out = StringBuilder()
        var i = start + 1
        var depth = 1
        while (i < s.length && depth > 0) {
            val c = s[i]
            when {
                c == '\\' && i + 1 < s.length -> {
                    when (val e = s[i + 1]) {
                        'n' -> out.append('\n')
                        'r' -> out.append('\r')
                        't' -> out.append('\t')
                        '(', ')', '\\' -> out.append(e)
                        else -> {
                            // Octal escape: up to 3 digits.
                            if (e.isDigit()) {
                                var j = i + 1
                                var code = 0
                                var count = 0
                                while (j < s.length && count < 3 && s[j].isDigit()) {
                                    code = code * 8 + (s[j] - '0')
                                    j++
                                    count++
                                }
                                out.append(code.toChar())
                                i = j
                                continue
                            } else out.append(e)
                        }
                    }
                    i += 2
                }
                c == '(' -> { depth++; out.append(c); i++ }
                c == ')' -> {
                    depth--
                    if (depth > 0) out.append(c)
                    i++
                }
                else -> { out.append(c); i++ }
            }
        }
        return Pair(out.toString(), i)
    }

    private fun readArray(s: String, start: Int): Pair<List<String>, Int> {
        val pieces = mutableListOf<String>()
        var i = start + 1
        while (i < s.length) {
            when (s[i]) {
                ']' -> return Pair(pieces, i + 1)
                '(' -> {
                    val (literal, end) = readLiteral(s, i)
                    pieces.add(literal)
                    i = end
                }
                '<' -> {
                    val end = s.indexOf('>', i)
                    if (end < 0) return Pair(pieces, s.length)
                    val hex = s.substring(i + 1, end).filter { it.isLetterOrDigit() }
                    val bytes = StringBuilder()
                    var h = 0
                    while (h + 1 < hex.length) {
                        bytes.append(hex.substring(h, h + 2).toIntOrNull(16)?.toChar() ?: '?')
                        h += 2
                    }
                    pieces.add(bytes.toString())
                    i = end + 1
                }
                else -> i++
            }
        }
        return Pair(pieces, i)
    }

    private fun indexOf(haystack: ByteArray, needle: ByteArray, from: Int): Int {
        if (needle.isEmpty() || haystack.size < needle.size) return -1
        outer@ for (start in from..haystack.size - needle.size) {
            for (k in needle.indices) {
                if (haystack[start + k] != needle[k]) continue@outer
            }
            return start
        }
        return -1
    }
}

package com.omsuite.android.util

import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream

/**
 * Pure EPUB reader over java.util.zip — no new library.
 * Parses META-INF/container.xml for the OPF path, then the OPF manifest +
 * spine to order chapters, and renders each chapter's XHTML as plain text
 * (tags stripped, paragraphs kept). Files not on the spine are ignored.
 * TXT books are handled by the caller as a single-chapter fallback.
 * Parsing is deliberately regex/string based so it runs in plain JVM tests
 * (no android.jar XML pull parser involved).
 */
object EpubParser {

    data class Chapter(val title: String, val href: String, val text: String)
    data class Book(val title: String, val chapters: List<Chapter>)

    /** Parse a whole EPUB file given as bytes. Throws IllegalArgumentException on bad input. */
    fun parse(epubBytes: ByteArray): Book {
        val entries = mutableMapOf<String, String>()
        try {
            ZipInputStream(ByteArrayInputStream(epubBytes)).use { zip ->
                var entry = zip.nextEntry
                while (entry != null) {
                    if (!entry.isDirectory) {
                        entries[entry.name] = zip.readBytes().toString(Charsets.UTF_8)
                    }
                    entry = zip.nextEntry
                }
            }
        } catch (e: Exception) {
            throw IllegalArgumentException("Not a readable EPUB zip: ${e.message}")
        }
        val container = entries["META-INF/container.xml"]
            ?: throw IllegalArgumentException("Not an EPUB: META-INF/container.xml missing")
        val opfPath = Regex("""full-path\s*=\s*"([^"]+)""").find(container)?.groupValues?.get(1)
            ?: throw IllegalArgumentException("container.xml has no rootfile full-path")
        val opf = entries[opfPath]
            ?: throw IllegalArgumentException("OPF file '$opfPath' missing from EPUB")
        val opfDir = opfPath.substringBeforeLast('/', "")
        val title = Regex("""<dc:title[^>]*>(.*?)</dc:title>""", RegexOption.DOT_MATCHES_ALL)
            .find(opf)?.groupValues?.get(1)?.let { unescape(it.trim()) } ?: "Untitled book"
        // Manifest: id -> href (only XHTML-ish items can be chapters).
        val manifest = mutableMapOf<String, String>()
        val itemRegex = Regex("""<item\b[^>]*>""")
        for (match in itemRegex.findAll(opf)) {
            val tag = match.value
            val id = Regex("""id\s*=\s*"([^"]+)""").find(tag)?.groupValues?.get(1) ?: continue
            val href = Regex("""href\s*=\s*"([^"]+)""").find(tag)?.groupValues?.get(1) ?: continue
            manifest[id] = href
        }
        val spineSection = Regex("""<spine\b.*?</spine>""", RegexOption.DOT_MATCHES_ALL)
            .find(opf)?.value ?: ""
        val spineIds = Regex("""idref\s*=\s*"([^"]+)""").findAll(spineSection)
            .map { it.groupValues[1] }.toList()
        if (spineIds.isEmpty()) throw IllegalArgumentException("EPUB spine is empty")
        val chapters = mutableListOf<Chapter>()
        for ((index, id) in spineIds.withIndex()) {
            val href = manifest[id] ?: continue
            val fullPath = if (opfDir.isEmpty()) href else "$opfDir/$href"
            val xhtml = entries[fullPath] ?: entries[href] ?: continue
            val plain = xhtmlToPlainText(xhtml)
            val chapterTitle = Regex("""<title[^>]*>(.*?)</title>""", RegexOption.DOT_MATCHES_ALL)
                .find(xhtml)?.groupValues?.get(1)?.let { unescape(it.trim()) }
                ?.takeIf { it.isNotBlank() }
                ?: "Chapter ${index + 1}"
            chapters.add(Chapter(chapterTitle, href, plain))
        }
        if (chapters.isEmpty()) throw IllegalArgumentException("No readable spine chapters found")
        return Book(title, chapters)
    }

    /** XHTML -> plain text: block ends become newlines, tags stripped, entities decoded. */
    fun xhtmlToPlainText(xhtml: String): String {
        var text = xhtml
        // Drop head/style/script blocks entirely.
        text = Regex("""<head\b.*?</head>""", RegexOption.DOT_MATCHES_ALL).replace(text, "")
        text = Regex("""<script\b.*?</script>""", RegexOption.DOT_MATCHES_ALL).replace(text, "")
        text = Regex("""<style\b.*?</style>""", RegexOption.DOT_MATCHES_ALL).replace(text, "")
        text = Regex("""<(br|hr)\b[^>]*/?>""").replace(text, "\n")
        text = Regex("""</(p|div|h[1-6]|li|tr|blockquote|section|article)>""").replace(text, "\n")
        text = Regex("""<li\b[^>]*>""").replace(text, "• ")
        text = Regex("""<[^>]+>""").replace(text, "")
        text = unescape(text)
        // Collapse 3+ newlines and trailing spaces per line, keep paragraphs.
        return text.lines()
            .map { it.trimEnd() }
            .joinToString("\n")
            .replace(Regex("\n{3,}"), "\n\n")
            .trim()
    }

    private fun unescape(text: String): String {
        var out = text
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&nbsp;", " ")
        out = Regex("&#(\\d+);").replace(out) { m ->
            val code = m.groupValues[1].toIntOrNull() ?: return@replace m.value
            if (code in 1..0x10FFFF) String(Character.toChars(code)) else m.value
        }
        out = Regex("&#x([0-9a-fA-F]+);").replace(out) { m ->
            val code = m.groupValues[1].toIntOrNull(16) ?: return@replace m.value
            if (code in 1..0x10FFFF) String(Character.toChars(code)) else m.value
        }
        return out
    }
}

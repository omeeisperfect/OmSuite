package com.omsuite.android

import com.omsuite.android.util.EpubParser
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EpubParserTest {

    private fun syntheticEpub(): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            fun add(name: String, content: String) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(content.toByteArray(Charsets.UTF_8))
                zip.closeEntry()
            }
            add(
                "META-INF/container.xml",
                """<?xml version="1.0"?><container><rootfiles>""" +
                    """<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>""" +
                    """</rootfiles></container>"""
            )
            add(
                "OEBPS/content.opf",
                """<?xml version="1.0"?><package><metadata>""" +
                    """<dc:title>Test Book</dc:title></metadata><manifest>""" +
                    """<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>""" +
                    """<item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>""" +
                    """</manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>"""
            )
            add(
                "OEBPS/ch1.xhtml",
                """<html><head><title>First</title></head><body>""" +
                    """<h1>Chapter One</h1><p>Hello <b>world</b>.</p><p>Second para.</p></body></html>"""
            )
            add(
                "OEBPS/ch2.xhtml",
                """<html><body><p>Fish &amp; chips.</p></body></html>"""
            )
        }
        return out.toByteArray()
    }

    @Test fun parses_title_spine_and_text() {
        val book = EpubParser.parse(syntheticEpub())
        assertEquals("Test Book", book.title)
        assertEquals(2, book.chapters.size)
        assertEquals("First", book.chapters[0].title)
        assertTrue(book.chapters[0].text.contains("Chapter One"))
        assertTrue(book.chapters[0].text.contains("Hello world."))
        assertTrue(book.chapters[0].text.contains("Second para."))
        assertTrue(book.chapters[1].text.contains("Fish & chips."))
    }

    @Test fun xhtml_strips_tags_keeps_paragraphs() {
        val plain = EpubParser.xhtmlToPlainText("<p>One</p><p>Two</p><script>evil()</script>")
        assertTrue(plain.contains("One"))
        assertTrue(plain.contains("Two"))
        assertTrue(!plain.contains("evil"))
        assertTrue(!plain.contains("<p>"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejects_non_epub() {
        EpubParser.parse("not a zip".toByteArray())
    }
}

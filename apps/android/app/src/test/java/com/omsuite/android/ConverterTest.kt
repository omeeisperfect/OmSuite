package com.omsuite.android

import com.omsuite.android.util.Converter
import com.omsuite.android.util.DeckExport
import com.omsuite.android.util.PdfTextExtractor
import com.omsuite.android.util.Slide
import com.omsuite.android.util.ZipUtils
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConverterTest {

    @Test fun csv_to_json_and_back_roundtrip() {
        val csv = "name,age\nAda,36\n\"Bo, B\",41"
        val json = Converter.csvToJson(csv)
        assertTrue(json.contains("\"name\": \"Ada\""))
        assertTrue(json.contains("\"age\": 36"))
        assertTrue(json.contains("\"Bo, B\""))
        val back = Converter.jsonToCsv(json)
        assertEquals(Converter.parseCsv(csv), Converter.parseCsv(back))
    }

    @Test fun json_to_csv_simple() {
        val csv = Converter.jsonToCsv("""[{"a": 1, "b": "x"}, {"a": 2, "b": "y"}]""")
        assertEquals(listOf(listOf("a", "b"), listOf("1", "x"), listOf("2", "y")), Converter.parseCsv(csv))
    }

    @Test fun json_pretty_print() {
        val pretty = Converter.convert("""{"a":1}""", "JSON", "JSON")
        assertTrue(pretty!!.contains("\n"))
        assertTrue(pretty.contains("\"a\": 1"))
    }

    @Test fun txt_to_markdown_heuristic_labelled() {
        val md = Converter.txtToMarkdown("MY NOTES\nSome text.\n- item one")
        assertTrue(md.contains("## MY NOTES"))
        assertTrue(md.contains("Some text."))
        assertTrue(md.contains("- item one"))
    }

    @Test fun unsupported_pair_returns_null() {
        assertNull(Converter.convert("hello", "MD", "CSV"))
        assertNull(Converter.convert("hello", "CSV", "MD"))
        assertNull(Converter.convert("hello", "TXT", "JSON"))
    }

    @Test fun csv_quoted_fields_parse() {
        val rows = Converter.parseCsv("a,b\n\"x, y\",\"say \"\"hi\"\"\"")
        assertEquals("x, y", rows[1][0])
        assertEquals("say \"hi\"", rows[1][1])
    }
}

class ZipAndDeckTest {

    @Test fun zip_create_list_extract_roundtrip() {
        val bytes = ZipUtils.createZip(
            listOf("a.txt" to "hello".toByteArray(), "dir/b.txt" to "world".toByteArray())
        )
        val entries = ZipUtils.listEntries(bytes)
        assertEquals(2, entries.size)
        val result = ZipUtils.extractAll(bytes)
        assertEquals("hello", result.files["a.txt"]!!.toString(Charsets.UTF_8))
        assertEquals("world", result.files["dir/b.txt"]!!.toString(Charsets.UTF_8))
        assertTrue(result.skippedUnsafe.isEmpty())
    }

    @Test fun zip_skips_traversal_entries() {
        // Build the traversal zip by hand: createZip rightly rejects it.
        val raw = run {
            val out = java.io.ByteArrayOutputStream()
            java.util.zip.ZipOutputStream(out).use { zip ->
                zip.putNextEntry(java.util.zip.ZipEntry("../evil.txt"))
                zip.write("x".toByteArray())
                zip.closeEntry()
            }
            out.toByteArray()
        }
        val result = ZipUtils.extractAll(raw)
        assertTrue(result.files.isEmpty())
        assertEquals(listOf("../evil.txt"), result.skippedUnsafe)
    }

    @Test fun deck_html_escapes_and_counts() {
        val html = DeckExport.toHtml(listOf(Slide("A <b>", "Line one\nLine two")), "Deck")
        assertTrue(html.contains("A &lt;b&gt;"))
        assertTrue(html.contains("Slide 1 of 1"))
        assertTrue(html.contains("Line two"))
    }
}

class PdfTextExtractorTest {

    private fun syntheticPdf(): ByteArray {
        // Minimal uncompressed PDF: one content stream with Tj + TJ operators.
        val pdf = StringBuilder()
        pdf.append("%PDF-1.4\n")
        pdf.append("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n")
        pdf.append("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n")
        pdf.append("4 0 obj << /Length 60 >> stream\n")
        pdf.append("BT /F1 12 Tf (Hello world) Tj ET\n")
        pdf.append("BT [(Foo) 120 (Bar)] TJ ET\n")
        pdf.append("endstream endobj\n")
        pdf.append("3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n")
        return pdf.toString().toByteArray(Charsets.ISO_8859_1)
    }

    @Test fun extracts_tj_and_tj_text() {
        val text = PdfTextExtractor.extract(syntheticPdf())
        assertTrue(text.contains("Hello world"))
        assertTrue(text.contains("Foo"))
        assertTrue(text.contains("Bar"))
    }

    @Test fun empty_for_no_text_streams() {
        assertEquals("", PdfTextExtractor.extract("%PDF-1.4\n%%EOF\n".toByteArray()))
    }
}

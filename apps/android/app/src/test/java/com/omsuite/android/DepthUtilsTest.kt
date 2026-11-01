package com.omsuite.android

import com.omsuite.android.util.DeckExport
import com.omsuite.android.util.FileUtils
import com.omsuite.android.util.Slide
import com.omsuite.android.util.ZipUtils
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FileUtilsUniqueNameTest {

    @Test fun unique_name_skips_existing_with_numbered_suffix() {
        assertEquals("a.txt", FileUtils.uniqueName(emptySet(), "a.txt"))
        assertEquals("a (1).txt", FileUtils.uniqueName(setOf("a.txt"), "a.txt"))
        assertEquals("a (2).txt", FileUtils.uniqueName(setOf("a.txt", "a (1).txt"), "a.txt"))
        assertEquals("notes (1)", FileUtils.uniqueName(setOf("notes"), "notes"))
        assertEquals("Copy of x (1).md", FileUtils.uniqueName(setOf("Copy of x.md"), "Copy of x.md"))
    }
}

class DeckExportImageTest {

    @Test fun images_and_notes_are_embedded_in_html() {
        val html = DeckExport.toHtml(
            listOf(Slide("T", "Body")),
            imageDataUris = mapOf(0 to "data:image/png;base64,AAA"),
            notes = mapOf(0 to "Say hello")
        )
        assertTrue(html.contains("<img src=\"data:image/png;base64,AAA\""))
        assertTrue(html.contains("Notes: Say hello"))
    }

    @Test fun export_without_images_has_no_img_tag() {
        val html = DeckExport.toHtml(listOf(Slide("T", "Body")))
        assertFalse(html.contains("<img"))
    }
}

class ZipSelectedTest {

    @Test fun extract_selected_returns_only_wanted_entries() {
        val zip = ZipUtils.createZip(
            listOf("a.txt" to "A".toByteArray(), "b.txt" to "B".toByteArray(), "dir/c.txt" to "C".toByteArray())
        )
        val result = ZipUtils.extractSelected(zip, setOf("b.txt", "dir/c.txt"))
        assertEquals(setOf("b.txt", "dir/c.txt"), result.files.keys)
        assertEquals("B", result.files["b.txt"]!!.toString(Charsets.UTF_8))
        assertTrue(result.skippedUnsafe.isEmpty())
        val all = ZipUtils.extractAll(zip)
        assertEquals(3, all.files.size)
    }

    @Test fun unsafe_entries_are_skipped_even_when_selected() {
        val zip = ZipUtils.createZip(listOf("ok.txt" to "OK".toByteArray()))
        // Craft a zip containing a traversal entry by hand (createZip refuses it).
        val crafted = run {
            val out = java.io.ByteArrayOutputStream()
            java.util.zip.ZipOutputStream(out).use { z ->
                z.putNextEntry(java.util.zip.ZipEntry("../evil.txt"))
                z.write("E".toByteArray())
                z.closeEntry()
                z.putNextEntry(java.util.zip.ZipEntry("ok.txt"))
                z.write("OK".toByteArray())
                z.closeEntry()
            }
            out.toByteArray()
        }
        val result = ZipUtils.extractSelected(crafted, setOf("../evil.txt", "ok.txt"))
        assertEquals(setOf("ok.txt"), result.files.keys)
        assertEquals(listOf("../evil.txt"), result.skippedUnsafe)
        assertEquals(1, ZipUtils.listEntries(zip).size)
    }
}

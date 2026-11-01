package com.omsuite.android

import com.omsuite.android.util.FileUtils
import com.omsuite.android.util.SortDirection
import com.omsuite.android.util.SortField
import com.omsuite.android.util.SortOrder
import com.omsuite.android.util.SortableEntry
import com.omsuite.android.util.sortEntries
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FileUtilsTest {
    @Test fun formatSize_bytes() { assertEquals("512 B", FileUtils.formatSize(512)) }
    @Test fun formatSize_kilobytes() { assertEquals("1.5 KB", FileUtils.formatSize(1536)) }
    @Test fun formatSize_megabytes() { assertEquals("2 MB", FileUtils.formatSize(2 * 1024 * 1024)) }
    @Test fun extension_lowercases() { assertEquals("json", FileUtils.extension("Data.JSON")) }
    @Test fun extension_none() { assertEquals("", FileUtils.extension("README")) }
    @Test fun editableText_types() {
        assertTrue(FileUtils.isEditableText("a.md"))
        assertTrue(FileUtils.isEditableText("a.yaml"))
        assertFalse(FileUtils.isEditableText("a.pdf"))
        assertFalse(FileUtils.isEditableText("a.docx"))
    }
    @Test fun archiveTraversal_rejected() {
        assertFalse(FileUtils.isSafeArchiveEntry("../evil.txt"))
        assertFalse(FileUtils.isSafeArchiveEntry("/abs.txt"))
        assertFalse(FileUtils.isSafeArchiveEntry("a/../../evil.txt"))
        assertTrue(FileUtils.isSafeArchiveEntry("folder/file.txt"))
    }
    @Test fun sort_foldersFirst_thenName() {
        val entries = listOf(
            SortableEntry("b.txt", false, 10, 3),
            SortableEntry("adir", true, 0, 1),
            SortableEntry("a.txt", false, 20, 2)
        )
        val sorted = sortEntries(entries, SortOrder(SortField.NAME, SortDirection.ASC))
        assertEquals(listOf("adir", "a.txt", "b.txt"), sorted.map { it.name })
    }
    @Test fun sort_bySize_desc() {
        val entries = listOf(
            SortableEntry("small.txt", false, 10, 1),
            SortableEntry("big.txt", false, 999, 1)
        )
        val sorted = sortEntries(entries, SortOrder(SortField.SIZE, SortDirection.DESC))
        assertEquals(listOf("big.txt", "small.txt"), sorted.map { it.name })
    }
}

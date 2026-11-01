package com.omsuite.android

import com.omsuite.android.util.ScanUtils
import com.omsuite.android.util.SearchUtils
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchUtilsTest {

    @Test fun occurrences_are_case_insensitive_and_non_overlapping() {
        assertEquals(listOf(0, 6), SearchUtils.findOccurrences("Hello hello", "hello"))
        assertEquals(listOf(0), SearchUtils.findOccurrences("aaa", "aa"))
        assertEquals(emptyList<Int>(), SearchUtils.findOccurrences("abc", ""))
        assertEquals(emptyList<Int>(), SearchUtils.findOccurrences("abc", "z"))
    }

    @Test fun snippet_centres_on_match_with_ellipses() {
        val text = "0123456789ABCDEFGHIJ0123456789"
        val snippet = SearchUtils.snippet(text, 10, 3, 5)
        assertTrue(snippet.contains("ABC"))
        assertTrue(snippet.startsWith("…"))
        assertTrue(snippet.endsWith("…"))
        assertEquals("hello", SearchUtils.snippet("hello", 0, 5, 40))
    }
}

class ScanUtilsTest {

    @Test fun crop_no_margins_is_full_image() {
        assertEquals(ScanUtils.Crop(0, 0, 1000, 800), ScanUtils.cropRect(1000, 800, 0, 0, 0, 0))
    }

    @Test fun crop_margins_trim_each_edge() {
        // 10% left of 1000 = 100; 25% top of 800 = 200; 10% right = 100; 0 bottom.
        assertEquals(ScanUtils.Crop(100, 200, 800, 600), ScanUtils.cropRect(1000, 800, 10, 25, 10, 0))
    }

    @Test fun crop_never_inverts_or_exceeds_bounds() {
        val crop = ScanUtils.cropRect(100, 100, 50, 50, 50, 50)
        assertTrue(crop.width >= 1 && crop.height >= 1)
        assertTrue(crop.left + crop.width <= 100)
        assertTrue(crop.top + crop.height <= 100)
        assertEquals(ScanUtils.Crop(0, 0, 0, 0), ScanUtils.cropRect(0, 0, 10, 10, 10, 10))
    }
}

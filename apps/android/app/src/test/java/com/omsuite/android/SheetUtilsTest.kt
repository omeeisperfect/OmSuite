package com.omsuite.android

import com.omsuite.android.util.SheetFormatting
import com.omsuite.android.util.sortSheetRows
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SheetUtilsTest {

    @Test fun iso_date_formatting() {
        assertEquals("1 Nov 2026", SheetFormatting.formatIsoDate("2026-11-01"))
        assertEquals("31 Dec 1999", SheetFormatting.formatIsoDate("1999-12-31"))
        assertNull(SheetFormatting.formatIsoDate("2026-13-01"))
        assertNull(SheetFormatting.formatIsoDate("not a date"))
        assertEquals(true, SheetFormatting.isIsoDate("2026-02-28"))
        assertEquals(false, SheetFormatting.isIsoDate("2026-02-30"))
    }

    @Test fun number_formatting() {
        assertEquals("3.50", SheetFormatting.formatNumber(3.5, 2))
        assertEquals("3", SheetFormatting.formatNumber(3.0, 0))
        assertEquals("-0.25", SheetFormatting.formatNumber(-0.25, 2))
    }

    @Test fun sort_keeps_header_fixed_and_sorts_numerically() {
        // Row 0 = header; rows 1..3 carry values in column A plus labels in B.
        val cells = mapOf(
            Pair(0, 0) to "Name", Pair(1, 0) to "Score",
            Pair(0, 1) to "b", Pair(1, 1) to "30",
            Pair(0, 2) to "a", Pair(1, 2) to "5",
            Pair(0, 3) to "c", Pair(1, 3) to "12"
        )
        val sorted = sortSheetRows(cells, 1, true)
        assertEquals("Name", sorted[Pair(0, 0)])
        // Numeric order by column B: 5, 12, 30 — whole rows move together.
        assertEquals("a", sorted[Pair(0, 1)])
        assertEquals("c", sorted[Pair(0, 2)])
        assertEquals("b", sorted[Pair(0, 3)])
        val desc = sortSheetRows(cells, 0, false)
        assertEquals("c", desc[Pair(0, 1)])
        assertEquals("b", desc[Pair(0, 2)])
        assertEquals("a", desc[Pair(0, 3)])
    }

    @Test fun sort_with_too_few_rows_is_identity() {
        val cells = mapOf(Pair(0, 0) to "H", Pair(0, 1) to "only")
        assertEquals(cells, sortSheetRows(cells, 0, true))
    }
}

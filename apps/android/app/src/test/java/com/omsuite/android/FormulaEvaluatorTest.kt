package com.omsuite.android

import com.omsuite.android.util.FormulaEvaluator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FormulaEvaluatorTest {

    private val grid = mapOf("A1" to 2.0, "A2" to 3.0, "B1" to 10.0, "B2" to 20.0)
    private val lookup: (String) -> Double? = { grid[it] }

    @Test fun arithmetic_and_precedence() {
        assertEquals(14.0, FormulaEvaluator.evaluate("=2+3*4", lookup)!!, 1e-9)
        assertEquals(20.0, FormulaEvaluator.evaluate("=(2+3)*4", lookup)!!, 1e-9)
        assertEquals(-5.0, FormulaEvaluator.evaluate("=-5", lookup)!!, 1e-9)
        assertEquals(2.5, FormulaEvaluator.evaluate("=5/2", lookup)!!, 1e-9)
    }

    @Test fun cell_refs() {
        assertEquals(5.0, FormulaEvaluator.evaluate("=A1+A2", lookup)!!, 1e-9)
        assertEquals(30.0, FormulaEvaluator.evaluate("=B1+B2", lookup)!!, 1e-9)
        assertEquals(5.0, FormulaEvaluator.evaluate("=a1+a2", lookup)!!, 1e-9)
    }

    @Test fun sum_and_average_over_range() {
        assertEquals(35.0, FormulaEvaluator.evaluate("=SUM(A1:B2)", lookup)!!, 1e-9)
        assertEquals(8.75, FormulaEvaluator.evaluate("=AVERAGE(A1:B2)", lookup)!!, 1e-9)
        assertEquals(5.0, FormulaEvaluator.evaluate("=SUM(A1:A2)", lookup)!!, 1e-9)
    }

    @Test fun errors_return_null() {
        assertNull(FormulaEvaluator.evaluate("=1/0", lookup))
        assertNull(FormulaEvaluator.evaluate("=A9+A1", lookup)) // empty ref
        assertNull(FormulaEvaluator.evaluate("=FOO(A1)", lookup))
        assertNull(FormulaEvaluator.evaluate("=(2+3", lookup))
        assertNull(FormulaEvaluator.evaluate("2+3", lookup)) // not a formula
    }

    @Test fun sum_single_cell() {
        assertEquals(2.0, FormulaEvaluator.evaluate("=SUM(A1)", lookup)!!, 1e-9)
    }

    @Test fun ref_parsing_roundtrip() {
        assertEquals(Pair(0, 0), FormulaEvaluator.parseRef("A1"))
        assertEquals(Pair(26, 0), FormulaEvaluator.parseRef("AA1"))
        assertEquals("A1", FormulaEvaluator.refName(0, 0))
        assertEquals("AA1", FormulaEvaluator.refName(26, 0))
        assertEquals(listOf("A1", "B1", "A2", "B2"), FormulaEvaluator.expandRange("A1", "B2"))
        assertNull(FormulaEvaluator.parseRef("A0"))
        assertNull(FormulaEvaluator.parseRef("1A"))
    }
}

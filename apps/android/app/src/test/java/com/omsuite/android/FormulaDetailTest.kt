package com.omsuite.android

import com.omsuite.android.util.FormulaError
import com.omsuite.android.util.FormulaEvaluator
import com.omsuite.android.util.formulaErrorText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class FormulaDetailTest {

    private val grid = mapOf("A1" to 2.0, "A2" to 3.0, "B1" to 10.0, "B2" to 20.0)
    private val lookup: (String) -> Double? = { grid[it] }

    @Test fun min_max_count_over_range() {
        assertEquals(2.0, FormulaEvaluator.evaluate("=MIN(A1:B2)", lookup)!!, 1e-9)
        assertEquals(20.0, FormulaEvaluator.evaluate("=MAX(A1:B2)", lookup)!!, 1e-9)
        assertEquals(4.0, FormulaEvaluator.evaluate("=COUNT(A1:B2)", lookup)!!, 1e-9)
        assertEquals(2.0, FormulaEvaluator.evaluate("=COUNT(A1:A2)", lookup)!!, 1e-9)
    }

    @Test fun detailed_errors_carry_codes() {
        assertEquals("DIV0", assertThrows(FormulaError::class.java) {
            FormulaEvaluator.evaluateOrThrow("=1/0", lookup)
        }.code)
        assertEquals("NAME", assertThrows(FormulaError::class.java) {
            FormulaEvaluator.evaluateOrThrow("=FOO(A1)", lookup)
        }.code)
        assertEquals("VALUE", assertThrows(FormulaError::class.java) {
            FormulaEvaluator.evaluateOrThrow("=A9+A1", lookup)
        }.code)
        assertEquals("CIRC", assertThrows(FormulaError::class.java) {
            FormulaEvaluator.evaluateOrThrow("=A1+1") { ref ->
                if (ref == "A1") throw FormulaError("CIRC") else grid[ref]
            }
        }.code)
    }

    @Test fun evaluate_still_returns_null_on_error() {
        assertNull(FormulaEvaluator.evaluate("=1/0", lookup))
        assertNull(FormulaEvaluator.evaluate("=FOO(A1)", lookup))
        assertNull(FormulaEvaluator.evaluate("=MIN(A9:A10)", lookup))
    }

    @Test fun error_text_mapping() {
        assertEquals("#DIV/0!", formulaErrorText("DIV0"))
        assertEquals("#CIRC!", formulaErrorText("CIRC"))
        assertEquals("#NAME?", formulaErrorText("NAME"))
        assertEquals("#REF!", formulaErrorText("REF"))
        assertEquals("#VALUE!", formulaErrorText("VALUE"))
        assertEquals("#ERR", formulaErrorText("BOGUS"))
    }
}

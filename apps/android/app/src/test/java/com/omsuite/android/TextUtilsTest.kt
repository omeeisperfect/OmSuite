package com.omsuite.android

import com.omsuite.android.util.JsonUtils
import com.omsuite.android.util.MarkdownParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TextUtilsTest {
    @Test fun json_valid() { assertTrue(JsonUtils.isValidJson("""{"a": 1}""")) }
    @Test fun json_invalid_unchanged() {
        assertFalse(JsonUtils.isValidJson("{not json"))
        assertNull(JsonUtils.formatJson("{not json"))
    }
    @Test fun json_format_pretty() {
        val out = JsonUtils.formatJson("""{"a":1}""")
        assertNotNull(out)
        assertTrue(out!!.contains("\n"))
    }
    @Test fun markdown_headings_and_lists() {
        val blocks = MarkdownParser.parse("# Title\n- one\n- two\nplain")
        assertEquals(MarkdownParser.BlockKind.HEADING1, blocks[0].kind)
        assertEquals("Title", blocks[0].text)
        assertEquals(2, blocks.count { it.kind == MarkdownParser.BlockKind.BULLET })
        assertEquals(MarkdownParser.BlockKind.PARAGRAPH, blocks.last().kind)
    }
    @Test fun markdown_code_block() {
        val blocks = MarkdownParser.parse("```\ncode line\n```")
        assertEquals(1, blocks.size)
        assertEquals(MarkdownParser.BlockKind.CODE, blocks[0].kind)
        assertTrue(blocks[0].text.contains("code line"))
    }
}

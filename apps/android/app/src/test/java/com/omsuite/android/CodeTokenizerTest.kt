package com.omsuite.android

import com.omsuite.android.util.CodeTokenizer
import com.omsuite.android.util.CodeTokenizer.Kind
import com.omsuite.android.util.CodeTokenizer.Language
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CodeTokenizerTest {

    @Test fun kotlin_keywords_strings_comments_numbers() {
        val tokens = CodeTokenizer.tokenize(
            "fun main() { // greet\n  val s = \"hi\"; val n = 42 }",
            Language.KOTLIN
        )
        val byKind = tokens.groupBy { it.kind }
        assertTrue(byKind[Kind.KEYWORD]!!.any { it.text == "fun" })
        assertTrue(byKind[Kind.KEYWORD]!!.any { it.text == "val" })
        assertTrue(byKind[Kind.STRING]!!.any { it.text == "\"hi\"" })
        assertTrue(byKind[Kind.COMMENT]!!.any { it.text == "// greet" })
        assertTrue(byKind[Kind.NUMBER]!!.any { it.text == "42" })
        // Reassembled tokens must equal the original source exactly.
        assertEquals(
            "fun main() { // greet\n  val s = \"hi\"; val n = 42 }",
            tokens.joinToString("") { it.text }
        )
    }

    @Test fun python_hash_comment_and_def() {
        val tokens = CodeTokenizer.tokenize("def f():\n  # note\n  return 3.5", Language.PYTHON)
        assertTrue(tokens.any { it.kind == Kind.KEYWORD && it.text == "def" })
        assertTrue(tokens.any { it.kind == Kind.COMMENT && it.text == "# note" })
        assertTrue(tokens.any { it.kind == Kind.NUMBER && it.text == "3.5" })
        assertEquals("def f():\n  # note\n  return 3.5", tokens.joinToString("") { it.text })
    }

    @Test fun javascript_block_comment_and_const() {
        val tokens = CodeTokenizer.tokenize("/* hi */ const x = 'a';", Language.JAVASCRIPT)
        assertTrue(tokens.any { it.kind == Kind.COMMENT && it.text == "/* hi */" })
        assertTrue(tokens.any { it.kind == Kind.KEYWORD && it.text == "const" })
        assertTrue(tokens.any { it.kind == Kind.STRING && it.text == "'a'" })
    }

    @Test fun plain_identifiers_are_not_keywords() {
        val tokens = CodeTokenizer.tokenize("valentine = 1", Language.KOTLIN)
        // "valentine" starts with "val" but is one identifier, not a keyword.
        assertTrue(tokens.none { it.kind == Kind.KEYWORD })
        assertTrue(tokens.any { it.kind == Kind.PLAIN && it.text == "valentine" })
    }
}

package com.omsuite.android.util

/** A slide: title + body text. The image (if any) lives only in the UI layer as a SAF Uri string. */
data class Slide(val title: String, val body: String)

/** Pure single-file HTML export for a slide deck — JVM-testable, no Android dependency. */
object DeckExport {

    /**
     * [imageDataUris] maps slide index -> "data:<mime>;base64,..." URI, so
     * attached images are genuinely embedded in the single HTML file
     * (the caller builds the data URI from the picked image bytes).
     * [notes] maps slide index -> speaker notes, exported as a notes paragraph.
     */
    fun toHtml(
        slides: List<Slide>,
        deckTitle: String = "OmSuite deck",
        imageDataUris: Map<Int, String> = emptyMap(),
        notes: Map<Int, String> = emptyMap()
    ): String {
        val escTitle = escape(deckTitle)
        return buildString {
            appendLine("<!DOCTYPE html>")
            appendLine("<html lang=\"en\"><head><meta charset=\"utf-8\">")
            appendLine("<title>$escTitle</title>")
            appendLine("<style>body{font-family:sans-serif;margin:2em}section{border:1px solid #ccc;padding:2em;margin-bottom:2em}h1{margin-top:0}.notes{color:#555;font-style:italic}</style>")
            appendLine("</head><body>")
            appendLine("<h1>$escTitle</h1>")
            if (slides.isEmpty()) appendLine("<p>(Empty deck)</p>")
            for ((index, slide) in slides.withIndex()) {
                appendLine("<section>")
                appendLine("<p>Slide ${index + 1} of ${slides.size}</p>")
                appendLine("<h1>${escape(slide.title)}</h1>")
                for (para in slide.body.lines()) {
                    if (para.isNotBlank()) appendLine("<p>${escape(para)}</p>")
                }
                imageDataUris[index]?.let { uri ->
                    appendLine("<img src=\"$uri\" alt=\"Slide image\" style=\"max-width:100%\">")
                }
                notes[index]?.takeIf { it.isNotBlank() }?.let { note ->
                    appendLine("<p class=\"notes\">Notes: ${escape(note)}</p>")
                }
                appendLine("</section>")
            }
            appendLine("</body></html>")
        }
    }

    private fun escape(s: String): String = s
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
}

package com.omsuite.android.util

/**
 * Pure crop geometry for Scan & OCR. Margins are percentages (0..50) of the
 * image dimension to trim from each edge. The result always covers at
 * least 1 pixel and never exceeds the image bounds.
 */
object ScanUtils {

    data class Crop(val left: Int, val top: Int, val width: Int, val height: Int)

    fun cropRect(
        imgW: Int,
        imgH: Int,
        leftPct: Int,
        topPct: Int,
        rightPct: Int,
        bottomPct: Int
    ): Crop {
        if (imgW <= 0 || imgH <= 0) return Crop(0, 0, 0, 0)
        val left = (imgW * leftPct.coerceIn(0, 50) / 100).coerceIn(0, imgW - 1)
        val top = (imgH * topPct.coerceIn(0, 50) / 100).coerceIn(0, imgH - 1)
        val right = (imgW * rightPct.coerceIn(0, 50) / 100).coerceIn(0, imgW - 1 - left)
        val bottom = (imgH * bottomPct.coerceIn(0, 50) / 100).coerceIn(0, imgH - 1 - top)
        val width = (imgW - left - right).coerceAtLeast(1)
        val height = (imgH - top - bottom).coerceAtLeast(1)
        return Crop(left, top, width, height)
    }
}

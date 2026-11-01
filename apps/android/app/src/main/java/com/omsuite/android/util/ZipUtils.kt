package com.omsuite.android.util

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * Pure ZIP helpers over java.util.zip — no Android dependency, JVM-testable.
 * Entry-name safety (no absolute paths, no ".." segments) is enforced here
 * with the same rule as FileUtils.isSafeArchiveEntry; unsafe entries are
 * skipped and reported, never written outside the target.
 */
object ZipUtils {

    data class EntryInfo(val name: String, val size: Long, val isDirectory: Boolean)

    /** Build a ZIP archive from (name -> bytes) pairs. Unsafe names are rejected. */
    fun createZip(entries: List<Pair<String, ByteArray>>): ByteArray {
        entries.forEach { (name, _) ->
            require(FileUtils.isSafeArchiveEntry(name) && !name.endsWith("/")) {
                "Unsafe ZIP entry name: $name"
            }
        }
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            for ((name, bytes) in entries) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(bytes)
                zip.closeEntry()
            }
        }
        return out.toByteArray()
    }

    /** List entries (name, uncompressed size, directory flag) without extracting. */
    fun listEntries(zipBytes: ByteArray): List<EntryInfo> {
        val out = mutableListOf<EntryInfo>()
        ZipInputStream(ByteArrayInputStream(zipBytes)).use { zip ->
            var entry = zip.nextEntry
            while (entry != null) {
                out.add(EntryInfo(entry.name, entry.size, entry.isDirectory))
                entry = zip.nextEntry
            }
        }
        return out
    }

    data class ExtractResult(val files: Map<String, ByteArray>, val skippedUnsafe: List<String>)

    /** Extract all entries into memory. Unsafe entries are skipped, not extracted. */
    fun extractAll(zipBytes: ByteArray): ExtractResult {
        val files = linkedMapOf<String, ByteArray>()
        val skipped = mutableListOf<String>()
        ZipInputStream(ByteArrayInputStream(zipBytes)).use { zip ->
            var entry = zip.nextEntry
            while (entry != null) {
                if (entry.isDirectory) {
                    // Directories carry no bytes; the screen recreates them as needed.
                } else if (!FileUtils.isSafeArchiveEntry(entry.name)) {
                    skipped.add(entry.name)
                } else {
                    files[entry.name] = zip.readBytes()
                }
                entry = zip.nextEntry
            }
        }
        return ExtractResult(files, skipped)
    }
}

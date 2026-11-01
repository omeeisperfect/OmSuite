package com.omsuite.android.data

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.documentfile.provider.DocumentFile
import com.omsuite.android.util.FileUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException

data class BrowserItem(
    val uri: Uri,
    val name: String,
    val isDir: Boolean,
    val size: Long,
    val modified: Long,
    val mime: String
)

/**
 * Real file operations over a user-granted SAF tree (DocumentFile).
 * No file is ever executed, no macro/script runs, no network call.
 * Archive handling (if ever added) must pass FileUtils.isSafeArchiveEntry.
 */
class FileRepository(private val context: Context) {

    fun rootFor(uri: Uri): DocumentFile? =
        DocumentFile.fromTreeUri(context, uri)

    suspend fun list(dir: DocumentFile): List<BrowserItem> = withContext(Dispatchers.IO) {
        dir.listFiles().mapNotNull { f ->
            val name = f.name ?: return@mapNotNull null
            BrowserItem(
                uri = f.uri, name = name, isDir = f.isDirectory,
                size = if (f.isDirectory) 0L else f.length(),
                modified = f.lastModified(), mime = f.type ?: FileUtils.mimeFor(name)
            )
        }
    }

    suspend fun createFolder(parent: DocumentFile, name: String): DocumentFile? =
        withContext(Dispatchers.IO) {
            require(name.isNotBlank() && !name.contains("/") && !name.contains("\\")) {
                "Invalid folder name"
            }
            parent.createDirectory(name)
        }

    suspend fun createFile(parent: DocumentFile, name: String, mime: String): DocumentFile? =
        withContext(Dispatchers.IO) {
            require(name.isNotBlank() && !name.contains("/")) { "Invalid file name" }
            parent.createFile(mime, name)
        }

    suspend fun rename(file: DocumentFile, newName: String): Boolean = withContext(Dispatchers.IO) {
        require(newName.isNotBlank() && !newName.contains("/")) { "Invalid name" }
        file.renameTo(newName)
    }

    suspend fun delete(file: DocumentFile): Boolean = withContext(Dispatchers.IO) { file.delete() }

    suspend fun copy(source: DocumentFile, destParent: DocumentFile, newName: String? = null): Boolean =
        withContext(Dispatchers.IO) {
            if (source.isDirectory) return@withContext copyDir(source, destParent, newName ?: (source.name ?: "copy"))
            val target = destParent.createFile(source.type ?: "*/*", newName ?: (source.name ?: "copy"))
                ?: return@withContext false
            context.contentResolver.openInputStream(source.uri)?.use { input ->
                context.contentResolver.openOutputStream(target.uri)?.use { output ->
                    input.copyTo(output)
                } ?: return@withContext false
            } ?: return@withContext false
            true
        }

    private suspend fun copyDir(source: DocumentFile, destParent: DocumentFile, name: String): Boolean {
        val dir = destParent.createDirectory(name) ?: return false
        for (child in source.listFiles()) {
            if (!copy(child, dir)) return false
        }
        return true
    }

    suspend fun move(source: DocumentFile, destParent: DocumentFile, newName: String? = null): Boolean =
        withContext(Dispatchers.IO) {
            // SAF has no atomic move: copy then delete source, verify copy first.
            if (!copy(source, destParent, newName)) return@withContext false
            source.delete()
        }

    /** Names of the direct children of [dir] (for conflict checks). */
    suspend fun childNames(dir: DocumentFile): List<String> = withContext(Dispatchers.IO) {
        dir.listFiles().mapNotNull { it.name }
    }

    /** Direct child of [dir] named [name], or null. */
    suspend fun findChild(dir: DocumentFile, name: String): DocumentFile? = withContext(Dispatchers.IO) {
        dir.findFile(name)
    }

    suspend fun readText(uri: Uri): String = withContext(Dispatchers.IO) {
        context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
            ?: throw IOException("Could not open file for reading")
    }

    suspend fun writeText(uri: Uri, text: String) = withContext(Dispatchers.IO) {
        context.contentResolver.openOutputStream(uri, "wt")?.bufferedWriter()?.use {
            it.write(text)
        } ?: throw IOException("Could not open file for writing")
    }

    fun persistTreePermission(uri: Uri) {
        try {
            context.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        } catch (e: SecurityException) {
            // Permission already held or not persistable on this device; tree still usable this session.
        }
    }

    fun releaseTreePermission(uri: Uri) {
        try {
            context.contentResolver.releasePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        } catch (e: Exception) { /* already released */ }
    }

    /** Resolve a child by walking path segments from a tree root — used for breadcrumbs. */
    fun childAt(root: DocumentFile, relativeSegments: List<String>): DocumentFile? {
        var current = root
        for (seg in relativeSegments) {
            current = current.findFile(seg) ?: return null
        }
        return current
    }

    fun documentId(uri: Uri): String? = try {
        DocumentsContract.getTreeDocumentId(uri)
    } catch (e: Exception) { null }

    fun resolver(): ContentResolver = context.contentResolver
}

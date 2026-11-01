package com.omsuite.android.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "omsuite_settings")

enum class ThemeChoice { SYSTEM, LIGHT, DARK }

/** Local-only settings. No account, no sync, no network. */
class SettingsStore(private val context: Context) {
    private val themeKey = stringPreferencesKey("theme")
    private val defaultFolderKey = stringPreferencesKey("default_folder_uri")
    private val defaultFolderNameKey = stringPreferencesKey("default_folder_name")
    private val conversionHistoryKey = stringPreferencesKey("conversion_history")

    val theme: Flow<ThemeChoice> = context.settingsDataStore.data.map { prefs ->
        runCatching { ThemeChoice.valueOf(prefs[themeKey] ?: "SYSTEM") }.getOrDefault(ThemeChoice.SYSTEM)
    }

    val defaultFolderUri: Flow<String?> = context.settingsDataStore.data.map { it[defaultFolderKey] }
    val defaultFolderName: Flow<String?> = context.settingsDataStore.data.map { it[defaultFolderNameKey] }

    suspend fun setTheme(choice: ThemeChoice) {
        context.settingsDataStore.edit { it[themeKey] = choice.name }
    }

    suspend fun setDefaultFolder(uri: String?, name: String?) {
        context.settingsDataStore.edit {
            if (uri == null) { it.remove(defaultFolderKey); it.remove(defaultFolderNameKey) }
            else { it[defaultFolderKey] = uri; if (name != null) it[defaultFolderNameKey] = name }
        }
    }

    /** Newest-first conversion history (max 10 entries), stored locally only. */
    val conversionHistory: Flow<List<String>> = context.settingsDataStore.data.map { prefs ->
        (prefs[conversionHistoryKey] ?: "").lines().filter { it.isNotBlank() }
    }

    suspend fun addConversionHistory(entry: String) {
        context.settingsDataStore.edit { prefs ->
            val current = (prefs[conversionHistoryKey] ?: "").lines().filter { it.isNotBlank() }
            prefs[conversionHistoryKey] = (listOf(entry) + current).take(10).joinToString("\n")
        }
    }

    suspend fun clearConversionHistory() {
        context.settingsDataStore.edit { it.remove(conversionHistoryKey) }
    }

    /**
     * Reading position per book: value is the chapter index as a string.
     * [bookId] is the book's SAF Uri string; keys are per-book, local only.
     */
    fun bookmarkFor(bookId: String): Flow<String?> =
        context.settingsDataStore.data.map { it[stringPreferencesKey("bookmark_$bookId")] }

    suspend fun setBookmark(bookId: String, value: String) {
        context.settingsDataStore.edit { it[stringPreferencesKey("bookmark_$bookId")] = value }
    }

    suspend fun clearBookmark(bookId: String) {
        context.settingsDataStore.edit { it.remove(stringPreferencesKey("bookmark_$bookId")) }
    }
}

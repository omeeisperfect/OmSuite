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
}

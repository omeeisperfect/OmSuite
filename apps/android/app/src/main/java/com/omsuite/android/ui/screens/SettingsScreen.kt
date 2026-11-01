package com.omsuite.android.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.omsuite.android.OmSuiteApp
import com.omsuite.android.data.ThemeChoice
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(app: OmSuiteApp) {
    val scope = rememberCoroutineScope()
    val theme by app.settings.theme.collectAsState(initial = ThemeChoice.SYSTEM)
    val defaultName by app.settings.defaultFolderName.collectAsState(initial = null)
    var status by remember { mutableStateOf<String?>(null) }
    var confirmClearRecents by remember { mutableStateOf(false) }

    val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
            app.files.persistTreePermission(uri)
            scope.launch {
                val root = app.files.rootFor(uri)
                app.settings.setDefaultFolder(uri.toString(), root?.name ?: "Folder")
                status = "Default save location set."
            }
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Text("Settings", style = androidx.compose.material3.MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(16.dp))
        Text("Appearance", style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
        ThemeChoice.values().forEach { choice ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                RadioButton(selected = theme == choice, onClick = { scope.launch { app.settings.setTheme(choice) } })
                Text(choice.name.lowercase().replaceFirstChar { it.uppercase() })
            }
        }
        Spacer(Modifier.height(16.dp))
        Text("Default save location", style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
        Text(
            defaultName?.let { "Currently: $it (used as the suggested folder for new files)" }
                ?: "Not set. New files ask where to save each time.",
            style = androidx.compose.material3.MaterialTheme.typography.bodyMedium
        )
        Row {
            Button(onClick = { folderPicker.launch(null) }) { Text("Choose folder") }
            Spacer(Modifier.padding(4.dp))
            OutlinedButton(onClick = { scope.launch { app.settings.setDefaultFolder(null, null); status = "Default save location cleared." } }) { Text("Clear") }
        }
        Spacer(Modifier.height(16.dp))
        Text("History & storage", style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
        Button(onClick = { confirmClearRecents = true }) { Text("Clear recent files") }
        Spacer(Modifier.height(8.dp))
        Button(onClick = {
            scope.launch {
                val deleted = app.cacheDir.listFiles()?.sumOf { if (it.deleteRecursively()) 1 else 0 } ?: 0
                status = "Cache cleared ($deleted entr${if (deleted == 1) "y" else "ies"} removed)."
            }
        }) { Text("Clear app cache") }
        status?.let { Text(it, style = androidx.compose.material3.MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)) }
        Spacer(Modifier.height(16.dp))
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("Privacy", style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
                Text(
                    "OmSuite is local-first. There is no account, no login, no cloud sync, " +
                        "no subscription and no telemetry. Files you grant access to stay on this " +
                        "device. Nothing is uploaded, silently or otherwise. Removing a granted " +
                        "folder in Files stops OmSuite using it; system permission can also be " +
                        "revoked in Android Settings → Apps → OmSuite → Permissions.",
                    style = androidx.compose.material3.MaterialTheme.typography.bodyMedium
                )
            }
        }
        Spacer(Modifier.height(16.dp))
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("About", style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
                Text("OmSuite for Android — version 0.1.0-debug (debug build, not a release).", style = androidx.compose.material3.MaterialTheme.typography.bodyMedium)
                Text("Project licence: not yet selected (no licence file is shipped).", style = androidx.compose.material3.MaterialTheme.typography.bodyMedium)
                Text(
                    "Implemented here: File Manager, Text/Code Editor, Settings. " +
                        "Not implemented: Sheets, Slides, PDF Studio, Media, E-books, Archives, Converter, Scan & OCR.",
                    style = androidx.compose.material3.MaterialTheme.typography.bodyMedium
                )
            }
        }
    }
    if (confirmClearRecents) {
        AlertDialog(
            onDismissRequest = { confirmClearRecents = false },
            title = { Text("Clear recent files?") },
            text = { Text("This clears the Recents list in OmSuite only. Your actual files are not deleted.") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch { app.db.recentDao().clearAll(); status = "Recent files cleared." }
                    confirmClearRecents = false
                }) { Text("Clear") }
            },
            dismissButton = { TextButton(onClick = { confirmClearRecents = false }) { Text("Cancel") } }
        )
    }
}


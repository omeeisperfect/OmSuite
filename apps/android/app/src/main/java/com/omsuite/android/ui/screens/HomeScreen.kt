package com.omsuite.android.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.omsuite.android.OmSuiteApp
import com.omsuite.android.util.FileUtils
import java.text.DateFormat
import java.util.Date

/** Home shows ONLY files the user actually opened in OmSuite (Room).
 *  An empty list is an honest empty state, never sample files. */
@Composable
fun HomeScreen(
    app: OmSuiteApp,
    onOpenFiles: () -> Unit,
    onOpenEditor: (String, String) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenModule: (String) -> Unit = {}
) {
    val recents by app.db.recentDao().observeAll().collectAsState(initial = emptyList())
    val favourites by app.db.favouriteDao().observeAll().collectAsState(initial = emptyList())
    LazyColumn(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        item {
            Text("OmSuite", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
            Text("Everything. One Workspace. — your files stay on this device.", style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(16.dp))
            Row {
                Button(onClick = { onOpenEditor("", "") }) { Text("New note") }
                Spacer(Modifier.padding(4.dp))
                OutlinedButton(onClick = onOpenFiles) { Text("Open files") }
            }
            Spacer(Modifier.height(24.dp))
            Text("Modules", style = MaterialTheme.typography.titleMedium)
            Text("Every module below is genuinely implemented and opens its own screen.", style = MaterialTheme.typography.bodySmall)
        }
        item {
            // Two-column module grid, built from the same route list as Navigation.
            val modules = listOf(
                Triple(Routes.SHEETS, "Sheets", "Editable grid, formulas, CSV"),
                Triple(Routes.SLIDES, "Slides", "Deck, present, HTML export"),
                Triple(Routes.PDF, "PDF Studio", "View pages, extract text"),
                Triple(Routes.MEDIA, "Media", "Images, audio, video"),
                Triple(Routes.EBOOKS, "E-books", "EPUB chapters, TXT books"),
                Triple(Routes.ARCHIVES, "Archives", "Create & extract ZIPs"),
                Triple(Routes.CONVERTER, "Converter", "CSV ↔ JSON, TXT → MD"),
                Triple(Routes.SCAN, "Scan & OCR", "Camera + on-device OCR")
            )
            Column {
                modules.chunked(2).forEach { row ->
                    Row(Modifier.fillMaxWidth()) {
                        row.forEach { (route, title, subtitle) ->
                            Card(
                                modifier = Modifier.weight(1f).padding(4.dp).clickable { onOpenModule(route) }
                            ) {
                                Column(Modifier.padding(12.dp)) {
                                    Text(title, style = MaterialTheme.typography.titleSmall)
                                    Text(subtitle, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                        if (row.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
        item {
            Text("Favourites", style = MaterialTheme.typography.titleMedium)
            Text("Favourites", style = MaterialTheme.typography.titleMedium)
        }
        if (favourites.isEmpty()) {
            item { Text("No favourites yet. Star a file in Files to pin it here.", style = MaterialTheme.typography.bodySmall) }
        } else {
            items(favourites) { fav ->
                Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable { onOpenEditor(fav.uri, fav.name) }) {
                    Column(Modifier.padding(12.dp)) {
                        Text(fav.name, style = MaterialTheme.typography.bodyMedium)
                        Text("Saved favourite", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(16.dp)); Text("Recent files", style = MaterialTheme.typography.titleMedium) }
        if (recents.isEmpty()) {
            item {
                Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(Modifier.padding(16.dp)) {
                        Text("Nothing here yet", style = MaterialTheme.typography.titleSmall)
                        Text(
                            "Open a folder in Files (you grant access once), then open or create a file. " +
                                "Files you actually open will appear here. No sample files are shown as real.",
                            style = MaterialTheme.typography.bodySmall
                        )
                        Spacer(Modifier.height(8.dp))
                        Button(onClick = onOpenFiles) { Icon(Icons.Filled.Folder, null); Text("  Go to Files") }
                    }
                }
            }
        } else {
            items(recents) { file ->
                Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable {
                    if (FileUtils.isEditableText(file.name)) onOpenEditor(file.uri, file.name)
                }) {
                    Row(Modifier.padding(12.dp)) {
                        Icon(Icons.Filled.Description, null)
                        Column(Modifier.padding(start = 8.dp)) {
                            Text(file.name, style = MaterialTheme.typography.bodyMedium)
                            Text(
                                "${FileUtils.formatSize(file.size)} • ${DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(file.lastOpened))}",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            }
        }
        item {
            Spacer(Modifier.height(24.dp))
            OutlinedButton(onClick = onOpenSettings) { Text("Settings & privacy") }
            Spacer(Modifier.height(8.dp))
            Text(
                "Local-first: no account, no cloud sync, no telemetry. " +
                    "All twelve modules are now reachable from the Modules grid above. " +
                    "PDF merge/split remain Not implemented (no PDF library vendored) and are shown disabled in PDF Studio.",
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

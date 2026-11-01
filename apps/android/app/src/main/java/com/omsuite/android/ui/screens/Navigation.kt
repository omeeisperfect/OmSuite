package com.omsuite.android.ui.screens

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.omsuite.android.OmSuiteApp

object Routes {
    const val HOME = "home"
    const val FILES = "files"
    const val EDITOR = "editor"
    const val SETTINGS = "settings"
    const val SHEETS = "sheets"
    const val SLIDES = "slides"
    const val PDF = "pdf"
    const val MEDIA = "media"
    const val EBOOKS = "ebooks"
    const val ARCHIVES = "archives"
    const val CONVERTER = "converter"
    const val SCAN = "scan"

    /** All module destinations, for the Home grid. */
    val MODULES = listOf(SHEETS, SLIDES, PDF, MEDIA, EBOOKS, ARCHIVES, CONVERTER, SCAN)
}

/** Session-only handoff for an editor target (a SAF Uri string). Avoids
 *  route-encoding corruption of content:// tree URIs. Cleared on open. */
object EditorLaunch {
    var uri: String? = null
    var name: String = ""
    fun set(u: String?, n: String) { uri = u; name = n }
    fun take(): Pair<String?, String> {
        val p = Pair(uri, name); uri = null; name = ""; return p
    }
}

/**
 * Bottom bar keeps the four primary destinations; every module screen is
 * reachable from the Home grid (and stays in the back stack, so Back
 * returns to Home). No module is listed anywhere it is not implemented.
 */
@Composable
fun OmSuiteNav(app: OmSuiteApp) {
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val current = backStack?.destination?.route
    // Module screens hide the bottom bar's selection (none of the four matches).
    Scaffold(
        bottomBar = {
            NavigationBar {
                listOf(
                    Triple(Routes.HOME, "Home", Icons.Filled.Home),
                    Triple(Routes.FILES, "Files", Icons.Filled.Folder),
                    Triple(Routes.EDITOR, "New note", Icons.Filled.Description),
                    Triple(Routes.SETTINGS, "Settings", Icons.Filled.Settings)
                ).forEach { (route, label, icon) ->
                    NavigationBarItem(
                        selected = current == route,
                        onClick = {
                            if (route == Routes.EDITOR) {
                                EditorLaunch.set(null, "")
                                nav.navigate(Routes.EDITOR) { launchSingleTop = true }
                            } else nav.navigate(route) { launchSingleTop = true }
                        },
                        icon = { Icon(icon, contentDescription = label) },
                        label = { Text(label) }
                    )
                }
            }
        }
    ) { inner ->
        NavHost(
            navController = nav,
            startDestination = Routes.HOME,
            modifier = Modifier.padding(inner)
        ) {
            composable(Routes.HOME) {
                HomeScreen(
                    app = app,
                    onOpenFiles = { nav.navigate(Routes.FILES) },
                    onOpenEditor = { uri, name -> EditorLaunch.set(uri, name); nav.navigate(Routes.EDITOR) },
                    onOpenSettings = { nav.navigate(Routes.SETTINGS) },
                    onOpenModule = { route -> nav.navigate(route) }
                )
            }
            composable(Routes.FILES) {
                FilesScreen(
                    app = app,
                    onOpenEditor = { uri, name -> EditorLaunch.set(uri, name); nav.navigate(Routes.EDITOR) }
                )
            }
            composable(Routes.EDITOR) {
                // remember: recomposition must not re-take (and clear) the launch.
                val (uri, name) = androidx.compose.runtime.remember { EditorLaunch.take() }
                EditorScreen(app = app, initialUri = uri, initialName = name, onBack = { nav.popBackStack() })
            }
            composable(Routes.SETTINGS) { SettingsScreen(app = app) }
            composable(Routes.SHEETS) { SheetsScreen(app = app) }
            composable(Routes.SLIDES) { SlidesScreen(app = app) }
            composable(Routes.PDF) { PdfScreen(app = app) }
            composable(Routes.MEDIA) { MediaScreen() }
            composable(Routes.EBOOKS) { EbookScreen(app = app) }
            composable(Routes.ARCHIVES) { ArchiveScreen(app = app) }
            composable(Routes.CONVERTER) { ConverterScreen(app = app) }
            composable(Routes.SCAN) { ScanScreen(app = app) }
        }
    }
}

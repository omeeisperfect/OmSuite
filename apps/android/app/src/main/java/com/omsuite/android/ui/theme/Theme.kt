package com.omsuite.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.omsuite.android.data.ThemeChoice

// Emerald accent, consistent with the prototype direction (#10b981).
val Emerald = Color(0xFF10B981)
val EmeraldDark = Color(0xFF059669)

private val LightScheme = lightColorScheme(
    primary = EmeraldDark,
    onPrimary = Color.White,
    secondary = Emerald,
    surface = Color(0xFFFFFFFF),
    background = Color(0xFFF6F7F9)
)

private val DarkScheme = darkColorScheme(
    primary = Emerald,
    onPrimary = Color(0xFF06281D),
    secondary = Emerald,
    surface = Color(0xFF121214),
    background = Color(0xFF09090B)
)

@Composable
fun OmSuiteTheme(choice: ThemeChoice, content: @Composable () -> Unit) {
    val dark = when (choice) {
        ThemeChoice.LIGHT -> false
        ThemeChoice.DARK -> true
        ThemeChoice.SYSTEM -> isSystemInDarkTheme()
    }
    MaterialTheme(
        colorScheme = if (dark) DarkScheme else LightScheme,
        content = content
    )
}

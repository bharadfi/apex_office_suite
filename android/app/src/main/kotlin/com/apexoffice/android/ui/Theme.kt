package com.apexoffice.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color

private val Light = lightColorScheme(
    primary = Color(0xFF176B4D),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFB8F0D4),
    onPrimaryContainer = Color(0xFF002114),
    secondary = Color(0xFF4C6358),
    background = Color(0xFFF6FBF6),
    surface = Color(0xFFF6FBF6),
    surfaceVariant = Color(0xFFDCE5DD),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF8DD4B1),
    onPrimary = Color(0xFF003824),
    primaryContainer = Color(0xFF00513A),
    onPrimaryContainer = Color(0xFFB8F0D4),
    secondary = Color(0xFFB2CCBE),
    background = Color(0xFF0F1511),
    surface = Color(0xFF0F1511),
    surfaceVariant = Color(0xFF404943),
)

/** Accent colour per editor, echoing the desktop file badges. */
object KindColors {
    val docs = Color(0xFF2B6CB0)
    val sheets = Color(0xFF1E8E5A)
    val slides = Color(0xFFD9622B)
    val pdf = Color(0xFFC53030)
    val markdown = Color(0xFF5A67D8)
    val html = Color(0xFF8E44AD)
}

@Composable
fun ApexTheme(content: @Composable () -> Unit) {
    val dark = when (com.apexoffice.android.Prefs.theme) {
        com.apexoffice.android.ThemeMode.SYSTEM -> isSystemInDarkTheme()
        com.apexoffice.android.ThemeMode.LIGHT -> false
        com.apexoffice.android.ThemeMode.DARK -> true
    }
    MaterialTheme(colorScheme = if (dark) Dark else Light) {
        androidx.compose.material3.Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, content = content)
    }
}
